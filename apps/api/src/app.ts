import type { Database } from "@duoshop/database";
import type { ObjectStorage } from "@duoshop/media";
import type { PaymentProviders } from "@duoshop/payments";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import { accountRoutes } from "./account";
import { cartRoutes } from "./cart";
import { catalogRoutes } from "./catalog";
import { categoryRoutes } from "./categories";
import { claimRoutes } from "./claims";
import { devLoginRoutes } from "./dev-login";
import { financeRoutes } from "./finance";
import { fulfilmentRoutes } from "./fulfilment";
import { mediaRoutes } from "./media";
import { merchantRoutes } from "./merchant";
import { type OidcSettings, oidcRoutes } from "./oidc";
import { orderRoutes } from "./orders";
import { paymentRoutes } from "./payments";
import { storefrontRoutes } from "./storefront";

export interface AppOptions {
  logger?: boolean;
  db?: Database;
  webOrigin?: string;
  oidc?: OidcSettings;
  // Tentatives de connexion par IP et par minute (mémoire locale ; Redis avant multi-instance).
  authRateLimit?: number;
  // Base publique (CDN/bucket) des images traitées ; absente => aucune image servie.
  mediaBaseUrl?: string;
  // Stockage objet des photos (ADR 0006) ; absent => envoi de photos indisponible (503 explicite).
  storage?: ObjectStorage;
  // Adaptateurs de paiement configurés (ADR 0007) ; aucun => aucun moyen proposé.
  providers?: PaymentProviders;
  // Développement uniquement : profils de démonstration quand Zitadel est absent.
  devLogin?: boolean;
  // Nombre de reverse proxies de confiance devant l'API (IP réelle pour rate limit et logs).
  trustProxy?: number;
}
export async function createApp({
  logger = false,
  db,
  webOrigin = "http://localhost:3000",
  oidc,
  authRateLimit = 20,
  mediaBaseUrl,
  storage,
  providers = new Map(),
  devLogin = false,
  trustProxy = 0,
}: AppOptions = {}) {
  const app = Fastify({
    logger: logger
      ? {
          level: process.env.LOG_LEVEL ?? "info",
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
            "password",
            "token",
          ],
          // Jamais de query string dans les logs : code OIDC, state et paramètres potentiellement personnels.
          serializers: {
            req: (req) => ({
              id: req.id,
              method: req.method,
              url: req.url.split("?")[0] ?? "",
            }),
          },
        }
      : false,
    // Validation stricte : un champ inconnu est refusé (400), jamais retiré en silence.
    ajv: { customOptions: { removeAdditional: false } },
    bodyLimit: 1048576,
    // Sans proxy déclaré, l'en-tête X-Forwarded-For est ignoré (sinon falsifiable par le client).
    trustProxy:
      trustProxy > 0
        ? (_address: string, hop: number) => hop < trustProxy
        : false,
  });
  await app.register(swagger, {
    openapi: { info: { title: "DuoShopAfrica foundations", version: "0.1.0" } },
  });
  app.get(
    "/health/live",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["status", "service", "stage"],
            properties: {
              status: { const: "ok" },
              service: { const: "api" },
              stage: { const: "foundation" },
            },
          },
        },
      },
    },
    async () => ({ status: "ok", service: "api", stage: "foundation" }),
  );
  // Readiness réelle : prête seulement si la base répond ; jamais de succès par défaut.
  app.get("/health/ready", async (request, reply) => {
    if (!db)
      return reply
        .code(503)
        .send({ status: "not_ready", reason: "database_not_configured" });
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: "ready" };
    } catch (err) {
      request.log.warn({ err }, "database unreachable");
      return reply
        .code(503)
        .send({ status: "not_ready", reason: "database_unreachable" });
    }
  });
  // Défini AVANT les plugins de routes : ils en héritent. Jamais de message interne au client.
  app.setErrorHandler((error, request, reply) => {
    const statusCode =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
        ? error.statusCode
        : 500;
    if (statusCode >= 500) request.log.error({ err: error }, "request failed");
    else request.log.info({ err: error }, "request refused");
    const code =
      error instanceof Error && "validation" in error && error.validation
        ? "invalid_request"
        : statusCode === 429
          ? "rate_limited"
          : "request_failed";
    reply.code(statusCode).send({ error: code, requestId: request.id });
  });
  await app.register(rateLimit, { global: false });
  if (db) {
    await app.register(accountRoutes, { db, webOrigin });
    await app.register(merchantRoutes, { db, webOrigin });
    await app.register(catalogRoutes, {
      db,
      webOrigin,
      ...(mediaBaseUrl ? { mediaBaseUrl } : {}),
    });
    await app.register(storefrontRoutes, {
      db,
      ...(mediaBaseUrl ? { mediaBaseUrl } : {}),
    });
    await app.register(categoryRoutes, { db, webOrigin });
    await app.register(cartRoutes, { db, webOrigin });
    await app.register(orderRoutes, { db, webOrigin });
    await app.register(paymentRoutes, { db, webOrigin, providers });
    await app.register(fulfilmentRoutes, { db, webOrigin });
    await app.register(financeRoutes, { db, webOrigin });
    await app.register(claimRoutes, { db, webOrigin });
    await app.register(mediaRoutes, {
      db,
      webOrigin,
      ...(storage ? { storage } : {}),
    });
    await app.register(oidcRoutes, {
      db,
      webOrigin,
      authRateLimit,
      devLogin,
      ...(oidc ? { oidc } : {}),
    });
    if (devLogin) await app.register(devLoginRoutes, { db, webOrigin });
  }
  app.get("/openapi.json", async () => app.swagger());
  return app;
}
