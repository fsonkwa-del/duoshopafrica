import { timingSafeEqual } from "node:crypto";
import { asRuntime, type Database, hashSessionToken } from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import * as client from "openid-client";
import {
  cookieHeader,
  openSession,
  readCookie,
  SESSION_ABSOLUTE_MS,
} from "./session";

export interface OidcSettings {
  issuer: string;
  clientId: string;
  clientSecret?: string;
}

const LOGIN_COOKIE = "__Host-login";
const LOGIN_TTL_MS = 10 * 60_000;
const clearLoginCookie = cookieHeader(LOGIN_COOKIE, "", 0);

export function oidcSettingsFromEnv(
  env: NodeJS.ProcessEnv,
): OidcSettings | undefined {
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID) return undefined;
  return {
    issuer: env.OIDC_ISSUER,
    clientId: env.OIDC_CLIENT_ID,
    ...(env.OIDC_CLIENT_SECRET ? { clientSecret: env.OIDC_CLIENT_SECRET } : {}),
  };
}

// Redirection interne uniquement : chemin localisé, aucun schéma ni hôte (pas d'open redirect).
export function safeReturnTo(value: unknown, locale: "fr" | "en"): string {
  return typeof value === "string" &&
    /^\/(fr|en)(\/[A-Za-z0-9\-._~/]*)?$/.test(value) &&
    !value.includes("//")
    ? value
    : `/${locale}/account`;
}

function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// HTTP accepté seulement pour un fournisseur local hors production (IdP de test ou Zitadel local).
function isLocalHttp(issuer: URL): boolean {
  return (
    issuer.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(issuer.hostname) &&
    process.env.NODE_ENV !== "production"
  );
}

export async function oidcRoutes(
  app: FastifyInstance,
  options: {
    db: Database;
    webOrigin: string;
    authRateLimit: number;
    oidc?: OidcSettings;
    devLogin?: boolean;
  },
) {
  const { db, webOrigin, oidc, devLogin = false } = options;
  const limited = {
    config: { rateLimit: { max: options.authRateLimit, timeWindow: 60_000 } },
  };
  const redirectUri = `${webOrigin}/v1/auth/callback`;
  let discovered: Promise<client.Configuration> | undefined;
  function configuration(settings: OidcSettings) {
    const issuer = new URL(settings.issuer);
    discovered ??= client
      .discovery(
        issuer,
        settings.clientId,
        undefined,
        settings.clientSecret
          ? client.ClientSecretBasic(settings.clientSecret)
          : client.None(),
        isLocalHttp(issuer) ? { execute: [client.allowInsecureRequests] } : {},
      )
      .catch((error) => {
        discovered = undefined;
        throw error;
      });
    return discovered;
  }

  app.get("/v1/auth/login", limited, async (request, reply) => {
    const query = request.query as { returnTo?: unknown; locale?: unknown };
    const locale = query.locale === "en" ? "en" : "fr";
    if (!oidc)
      return devLogin
        ? reply.redirect(
            `/${locale}/dev-login?${new URLSearchParams({ returnTo: safeReturnTo(query.returnTo, locale) })}`,
            302,
          )
        : reply.code(503).send({ error: "identity_provider_not_configured" });
    let config: client.Configuration;
    try {
      config = await configuration(oidc);
    } catch (err) {
      request.log.error({ err }, "identity provider discovery failed");
      return reply.code(503).send({ error: "identity_provider_unavailable" });
    }
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    await asRuntime(db, {}, (tx) =>
      tx.loginAttempt.create({
        data: {
          stateHash: hashSessionToken(state),
          nonce,
          codeVerifier,
          returnTo: safeReturnTo(query.returnTo, locale),
          expiresAt: new Date(Date.now() + LOGIN_TTL_MS),
        },
      }),
    );
    const url = client.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      ui_locales: locale,
    });
    return reply
      .header(
        "set-cookie",
        cookieHeader(LOGIN_COOKIE, state, LOGIN_TTL_MS / 1000),
      )
      .redirect(url.href, 302);
  });

  app.get("/v1/auth/callback", limited, async (request, reply) => {
    const fail = (reason: string, locale = "fr") => {
      request.log.warn({ reason }, "login rejected");
      return reply
        .header("set-cookie", clearLoginCookie)
        .redirect(`/${locale}/account?error=login_failed`, 302);
    };
    if (!oidc) return fail("identity_provider_not_configured");
    const { state } = request.query as { state?: unknown };
    const bound = readCookie(request, LOGIN_COOKIE);
    // Le state doit revenir dans le navigateur qui a lancé la connexion (anti login-CSRF).
    if (typeof state !== "string" || !bound || !sameSecret(state, bound))
      return fail("state_not_bound_to_browser");
    const now = new Date();
    const attempt = await asRuntime(db, {}, async (tx) => {
      const found = await tx.loginAttempt.findUnique({
        where: { stateHash: hashSessionToken(state) },
      });
      if (!found || found.consumedAt || found.expiresAt <= now) return null;
      const { count } = await tx.loginAttempt.updateMany({
        where: { id: found.id, consumedAt: null },
        data: { consumedAt: now },
      });
      return count === 1 ? found : null;
    });
    if (!attempt) return fail("attempt_missing_used_or_expired");
    const locale = attempt.returnTo.startsWith("/en") ? "en" : "fr";
    let claims: client.IDToken | undefined;
    try {
      const tokens = await client.authorizationCodeGrant(
        await configuration(oidc),
        new URL(request.url, webOrigin),
        {
          pkceCodeVerifier: attempt.codeVerifier,
          expectedState: state,
          expectedNonce: attempt.nonce,
          idTokenExpected: true,
        },
      );
      claims = tokens.claims();
    } catch (err) {
      request.log.warn({ err }, "authorization code exchange failed");
      return fail("code_exchange_failed", locale);
    }
    if (!claims) return fail("id_token_missing", locale);
    if (typeof claims.email !== "string" || claims.email_verified !== true)
      return fail("email_not_verified", locale);
    const [linked] = await asRuntime(
      db,
      {},
      (tx) =>
        tx.$queryRaw<{ id: string }[]>`
          SELECT auth_link_identity(${claims.iss}, ${claims.sub}, ${claims.email}) AS id`,
    );
    if (!linked) return fail("identity_link_failed", locale);
    const mfa = Array.isArray(claims.amr) && claims.amr.includes("mfa");
    const token = await openSession(db, linked.id, mfa);
    return reply
      .header("set-cookie", [
        cookieHeader(SESSION_COOKIE, token, SESSION_ABSOLUTE_MS / 1000),
        clearLoginCookie,
      ])
      .redirect(attempt.returnTo, 302);
  });
}
