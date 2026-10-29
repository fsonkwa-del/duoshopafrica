import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { SESSION_COOKIE } from "@duoshop/types";

// Smoke RÉEL contre un Zitadel local (voir docs/OPERATIONS.md) et l'API démarrée avec OIDC_*.
// Le formulaire de login est remplacé par l'API Session v2 + CreateCallback de Zitadel,
// mécanisme officiel des interfaces de login personnalisées : aucun jeton n'est simulé.
const dir = process.env.ZITADEL_DIR ?? "../../.local/zitadel";
const zitadel = process.env.OIDC_ISSUER ?? "http://localhost:8080";
const api = process.env.API_URL ?? "http://127.0.0.1:4000";
const pat = (file: string) => readFileSync(`${dir}/${file}`, "utf8").trim();
const admin = { authorization: `Bearer ${pat("provisioner.pat")}` };
const loginClient = { authorization: `Bearer ${pat("login-client.pat")}` };
const password = "Dev-Only-Passw0rd!";

async function call(
  url: string,
  init: RequestInit & { headers?: Record<string, string> } = {},
) {
  const response = await fetch(url, {
    ...init,
    redirect: "manual",
    headers: { "content-type": "application/json", ...init.headers },
  });
  const text = await response.text();
  if (response.status >= 400 && init.method === "POST")
    throw new Error(`${url} -> ${response.status} ${text}`);
  const json = response.headers.get("content-type")?.includes("json");
  return {
    response,
    body: json && text ? (JSON.parse(text) as Record<string, unknown>) : {},
  };
}
function setCookie(response: Response, name: string) {
  return response.headers
    .getSetCookie()
    .find((c) => c.startsWith(`${name}=`))
    ?.split(";")[0]
    ?.slice(name.length + 1);
}
// RFC 6238, SHA-1, 6 chiffres, pas de 30 s : uniquement pour le compte de test local.
function totp(secretBase32: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretBase32.replace(/=+$/, ""))
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const key = Buffer.from(
    bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? [],
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const mac = createHmac("sha1", key).update(counter).digest();
  const offset = (mac.at(-1) ?? 0) & 0xf;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(
    6,
    "0",
  );
}

async function createUser(email: string) {
  const { body } = await call(`${zitadel}/v2/users/human`, {
    method: "POST",
    headers: admin,
    body: JSON.stringify({
      username: email,
      profile: { givenName: "Smoke", familyName: "Test" },
      email: { email, isVerified: true },
      password: { password, changeRequired: false },
    }),
  });
  return String(body.userId);
}

async function signIn(
  loginName: string,
  extraChecks: Record<string, unknown> = {},
) {
  const start = await call(
    `${api}/v1/auth/login?returnTo=/fr/account&locale=fr`,
  );
  assert.equal(start.response.status, 302, "API must redirect to Zitadel");
  const bound = setCookie(start.response, "__Host-login");
  const authorize = String(start.response.headers.get("location"));
  assert.ok(authorize.startsWith(`${zitadel}/oauth/v2/authorize`), authorize);
  const toLogin = await call(authorize);
  const authRequest = new URL(
    String(toLogin.response.headers.get("location")),
    zitadel,
  ).searchParams.get("authRequest");
  assert.ok(
    authRequest?.startsWith("V2_"),
    "Zitadel Login V2 auth request expected",
  );
  const session = await call(`${zitadel}/v2/sessions`, {
    method: "POST",
    headers: loginClient,
    body: JSON.stringify({
      checks: { user: { loginName }, password: { password }, ...extraChecks },
    }),
  });
  const callback = await call(
    `${zitadel}/v2/oidc/auth_requests/${authRequest}`,
    {
      method: "POST",
      headers: loginClient,
      body: JSON.stringify({
        session: {
          sessionId: session.body.sessionId,
          sessionToken: session.body.sessionToken,
        },
      }),
    },
  );
  const target = new URL(String(callback.body.callbackUrl));
  const finish = await call(`${api}${target.pathname}${target.search}`, {
    headers: { cookie: `__Host-login=${bound}` },
  });
  return {
    finish,
    bound,
    target,
    session: setCookie(finish.response, SESSION_COOKIE),
  };
}
const me = (session?: string) =>
  call(`${api}/v1/me`, { headers: { cookie: `${SESSION_COOKIE}=${session}` } });

const email = `smoke-${randomUUID().slice(0, 8)}@example.invalid`;
await createUser(email);
const first = await signIn(email);
assert.equal(first.finish.response.headers.get("location"), "/fr/account");
const profile = await me(first.session);
assert.equal(profile.response.status, 200);
assert.equal(profile.body.email, email);
assert.equal(profile.body.mfa, false);
console.info(`OK password login -> session for ${email}, mfa=false`);

const replay = await call(
  `${api}${first.target.pathname}${first.target.search}`,
  {
    headers: { cookie: `__Host-login=${first.bound}` },
  },
);
assert.equal(
  replay.response.headers.get("location"),
  "/fr/account?error=login_failed",
);
console.info("OK replayed callback refused");

const mfaEmail = `smoke-mfa-${randomUUID().slice(0, 8)}@example.invalid`;
const mfaUser = await createUser(mfaEmail);
const enrol = await call(`${zitadel}/v2/users/${mfaUser}/totp`, {
  method: "POST",
  headers: admin,
  body: "{}",
});
const secret = String(enrol.body.secret);
await call(`${zitadel}/v2/users/${mfaUser}/totp/verify`, {
  method: "POST",
  headers: admin,
  body: JSON.stringify({ code: totp(secret) }),
});
// Code suivant : Zitadel refuse la réutilisation d'un code TOTP déjà consommé.
await new Promise((resolve) =>
  setTimeout(resolve, 30_000 - (Date.now() % 30_000) + 500),
);
const strong = await signIn(mfaEmail, { totp: { code: totp(secret) } });
const strongProfile = await me(strong.session);
assert.equal(
  strongProfile.body.mfa,
  true,
  "amr must attest MFA after password + TOTP",
);
console.info(`OK password + TOTP login -> mfa=true for ${mfaEmail}`);
