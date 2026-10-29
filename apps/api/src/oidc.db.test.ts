import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, describe, test } from "node:test";
import { createDatabase } from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import Fastify from "fastify";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApp } from "./app";
import { safeReturnTo } from "./oidc";

// IdP de test local : clés RSA réelles, id_token signés, PKCE vérifié au token endpoint.
const idp = Fastify();
const clientId = "duoshop-test-client";
const keys = await generateKeyPair("RS256");
const codes = new Map<
  string,
  { challenge: string; redirectUri: string; idToken: string }
>();
idp.addContentTypeParser(
  "application/x-www-form-urlencoded",
  { parseAs: "string" },
  (_request, body, done) =>
    done(null, Object.fromEntries(new URLSearchParams(String(body)))),
);
let issuer = "";
idp.get("/.well-known/openid-configuration", async () => ({
  issuer,
  authorization_endpoint: `${issuer}/authorize`,
  token_endpoint: `${issuer}/token`,
  jwks_uri: `${issuer}/jwks`,
  response_types_supported: ["code"],
  subject_types_supported: ["public"],
  id_token_signing_alg_values_supported: ["RS256"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
}));
idp.get("/jwks", async () => ({
  keys: [{ ...(await exportJWK(keys.publicKey)), kid: "k1", alg: "RS256" }],
}));
idp.post("/token", async (request, reply) => {
  const body = request.body as Record<string, string>;
  const grant = codes.get(body.code ?? "");
  codes.delete(body.code ?? "");
  const verifier = createHash("sha256")
    .update(body.code_verifier ?? "")
    .digest("base64url");
  if (
    !grant ||
    body.client_id !== clientId ||
    body.redirect_uri !== grant.redirectUri ||
    verifier !== grant.challenge
  )
    return reply.code(400).send({ error: "invalid_grant" });
  return {
    access_token: randomUUID(),
    token_type: "Bearer",
    expires_in: 300,
    id_token: grant.idToken,
  };
});

await idp.listen({ host: "127.0.0.1", port: 0 });
const address = idp.server.address();
assert.ok(address && typeof address === "object");
issuer = `http://127.0.0.1:${address.port}`;

const db = createDatabase({ max: 2 });
const webOrigin = "http://localhost:3000";
// Limite haute ici : la suite enchaîne volontairement plus de 20 connexions.
const app = await createApp({
  db,
  webOrigin,
  oidc: { issuer, clientId },
  authRateLimit: 1000,
});
const unconfigured = await createApp({ db, webOrigin, authRateLimit: 2 });
const startedAt = new Date();
const emails: string[] = [];

interface LoginOptions {
  email?: string;
  sub?: string;
  emailVerified?: boolean;
  amr?: string[];
  audience?: string;
  nonce?: string;
  returnTo?: string;
  locale?: string;
}
function cookie(response: { headers: Record<string, unknown> }, name: string) {
  const all = [response.headers["set-cookie"] ?? []].flat() as string[];
  return all
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0]
    ?.slice(name.length + 1);
}
async function startLogin(options: LoginOptions = {}) {
  const query = new URLSearchParams({
    returnTo: options.returnTo ?? "/fr/account",
    locale: options.locale ?? "fr",
  });
  const start = await app.inject(`/v1/auth/login?${query}`);
  assert.equal(start.statusCode, 302);
  const authorize = new URL(String(start.headers.location));
  const params = authorize.searchParams;
  const email = options.email ?? `${randomUUID()}@example.invalid`;
  emails.push(email.toLowerCase());
  const idToken = await new SignJWT({
    nonce: options.nonce ?? params.get("nonce"),
    email,
    email_verified: options.emailVerified ?? true,
    amr: options.amr ?? ["pwd"],
  })
    .setProtectedHeader({ alg: "RS256", kid: "k1" })
    .setIssuer(issuer)
    .setAudience(options.audience ?? clientId)
    .setSubject(options.sub ?? randomUUID())
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  const code = randomUUID();
  codes.set(code, {
    challenge: String(params.get("code_challenge")),
    redirectUri: String(params.get("redirect_uri")),
    idToken,
  });
  return {
    authorize,
    state: String(params.get("state")),
    loginCookie: cookie(start, "__Host-login"),
    callback: `/v1/auth/callback?code=${code}&state=${params.get("state")}`,
  };
}
async function login(options: LoginOptions = {}) {
  const flow = await startLogin(options);
  const response = await app.inject({
    url: flow.callback,
    headers: { cookie: `__Host-login=${flow.loginCookie}` },
  });
  return { ...flow, response, session: cookie(response, SESSION_COOKIE) };
}
const me = (session: string | undefined) =>
  app.inject({
    url: "/v1/me",
    headers: { cookie: `${SESSION_COOKIE}=${session}` },
  });

after(async () => {
  await Promise.all([app.close(), unconfigured.close(), idp.close()]);
  const users = await db.user.findMany({
    where: { email: { in: emails } },
    select: { id: true },
  });
  const userId = { in: users.map((u) => u.id) };
  await db.session.deleteMany({ where: { userId } });
  await db.identity.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.loginAttempt.deleteMany({
    where: { createdAt: { gte: startedAt } },
  });
  await db.$disconnect();
});

describe("OIDC login", () => {
  test("starts an authorization code flow with PKCE S256, state and nonce", async () => {
    const { authorize, loginCookie, state } = await startLogin({
      locale: "en",
    });
    const params = authorize.searchParams;
    assert.equal(authorize.origin + authorize.pathname, `${issuer}/authorize`);
    assert.equal(params.get("response_type"), "code");
    assert.equal(params.get("code_challenge_method"), "S256");
    assert.equal(params.get("redirect_uri"), `${webOrigin}/v1/auth/callback`);
    assert.equal(params.get("ui_locales"), "en");
    assert.match(String(params.get("scope")), /openid/);
    assert.ok(params.get("nonce"));
    assert.equal(loginCookie, state);
  });

  test("a verified identity gets a session and lands on the requested page", async () => {
    const { response, session } = await login({ returnTo: "/en/account" });
    assert.equal(response.statusCode, 302);
    assert.equal(response.headers.location, "/en/account");
    assert.ok(session);
    const profile = await me(session);
    assert.equal(profile.statusCode, 200);
    assert.equal(profile.json().mfa, false);
  });

  test("the same subject always maps to the same user", async () => {
    const sub = randomUUID();
    const email = `${randomUUID()}@example.invalid`;
    const first = await me((await login({ sub, email })).session);
    const second = await me((await login({ sub, email })).session);
    assert.equal(first.json().id, second.json().id);
  });

  test("links an existing account by verified email, case-insensitively", async () => {
    const email = `${randomUUID()}@example.invalid`;
    emails.push(email);
    const existing = await db.user.create({ data: { email } });
    const { session } = await login({ email: email.toUpperCase() });
    assert.equal((await me(session)).json().id, existing.id);
  });

  test("records MFA only when the provider attests it", async () => {
    const { session } = await login({ amr: ["pwd", "mfa"] });
    assert.equal((await me(session)).json().mfa, true);
  });

  test("refuses unverified emails without creating anything", async () => {
    const email = `${randomUUID()}@example.invalid`;
    const { response, session } = await login({ email, emailVerified: false });
    assert.equal(response.headers.location, "/fr/account?error=login_failed");
    assert.equal(session, undefined);
    assert.equal(await db.user.count({ where: { email } }), 0);
  });

  test("rejects a callback from another browser (state not bound)", async () => {
    const flow = await startLogin();
    for (const headers of [{}, { cookie: `__Host-login=${"x".repeat(43)}` }]) {
      const response = await app.inject({ url: flow.callback, headers });
      assert.equal(response.headers.location, "/fr/account?error=login_failed");
      assert.equal(cookie(response, SESSION_COOKIE), undefined);
    }
  });

  test("a callback cannot be replayed", async () => {
    const flow = await login();
    assert.ok(flow.session);
    const replay = await app.inject({
      url: flow.callback,
      headers: { cookie: `__Host-login=${flow.loginCookie}` },
    });
    assert.equal(replay.headers.location, "/fr/account?error=login_failed");
    assert.equal(cookie(replay, SESSION_COOKIE), undefined);
  });

  test("an expired attempt is refused", async () => {
    const flow = await startLogin();
    await db.loginAttempt.updateMany({
      where: {
        stateHash: createHash("sha256").update(flow.state).digest("hex"),
      },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const response = await app.inject({
      url: flow.callback,
      headers: { cookie: `__Host-login=${flow.loginCookie}` },
    });
    assert.equal(response.headers.location, "/fr/account?error=login_failed");
  });

  test("rejects id tokens with a wrong nonce or audience", async () => {
    for (const options of [{ nonce: "forged" }, { audience: "other-client" }]) {
      const { response, session } = await login(options);
      assert.equal(response.headers.location, "/fr/account?error=login_failed");
      assert.equal(session, undefined, JSON.stringify(options));
    }
  });

  test("never redirects outside the site", async () => {
    for (const target of [
      "//evil.example",
      "https://evil.example",
      "/fr//evil",
      "/de/x",
    ])
      assert.equal(safeReturnTo(target, "fr"), "/fr/account");
    assert.equal(
      safeReturnTo("/en/account/stores/abc", "en"),
      "/en/account/stores/abc",
    );
    const { response } = await login({ returnTo: "https://evil.example" });
    assert.equal(response.headers.location, "/fr/account");
  });

  test("reports a missing provider instead of pretending", async () => {
    const response = await unconfigured.inject("/v1/auth/login");
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      error: "identity_provider_not_configured",
    });
  });

  test("throttles repeated sign-in attempts from one address", async () => {
    // Limite 2 par route : la requête du test précédent compte, la suivante passe, puis 429.
    assert.equal((await unconfigured.inject("/v1/auth/login")).statusCode, 503);
    const throttled = await unconfigured.inject("/v1/auth/login");
    assert.equal(throttled.statusCode, 429);
    assert.ok(throttled.headers["retry-after"]);
  });
});

describe("session lifetime", () => {
  test("an idle session expires after 30 minutes", async () => {
    const { session } = await login();
    assert.equal((await me(session)).statusCode, 200);
    await db.session.updateMany({
      where: {
        tokenHash: createHash("sha256").update(String(session)).digest("hex"),
      },
      data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
    });
    assert.equal((await me(session)).statusCode, 401);
  });
});
