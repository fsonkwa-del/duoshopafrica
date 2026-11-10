import { asRuntime, type Database } from "@duoshop/database";
import {
  type CollectionSettings,
  MERCHANT_FIELDS,
  missingCapabilities,
  openCredentials,
  type PaymentProvider,
  type PaymentProviders,
  providerForAccount,
  sealCredentials,
} from "@duoshop/payments";
import type { FastifyInstance } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { requireStaff } from "./staff";
import { inStore } from "./store-scope";

// Lot 3 (ADR 0011) : mode d'encaissement, comptes marchands des vendeurs, autorisation du mode
// « plateforme détentrice des fonds ».
export const defaultCollection: CollectionSettings = {
  mode: "PLATFORM_HELD",
  keys: new Map(),
  currentKeyVersion: 1,
};

// Démarrage : un mode qui exige une capacité absente est refusé ; avec de l'argent réel, la
// plateforme ne détient les fonds qu'avec une autorisation approuvée par deux personnes.
export async function assertCollectionMode(
  db: Database,
  collection: CollectionSettings,
  providers: PaymentProviders,
  env: Record<string, string | undefined>,
): Promise<void> {
  // Mode direct : les adaptateurs sont construits par compte vendeur (MERCHANT_FIELDS).
  if (collection.mode !== "DIRECT_SELLER") {
    const missing = missingCapabilities(collection.mode, providers);
    if (missing.length)
      throw new Error(
        `COLLECTION_MODE ${collection.mode} needs provider capabilities: ${missing.join(", ")}`,
      );
  }
  // Production = argent réel : un prestataire de la plateforme configuré en LIVE. La
  // pré-production (sandbox) garde le mode actuel sans autorisation.
  const realMoney =
    env.NODE_ENV === "production" &&
    [...providers.values()].some((p) => p.mode === "LIVE");
  if (collection.mode === "PLATFORM_HELD" && realMoney) {
    const [row] = await db.$queryRaw<{ ok: boolean }[]>`
      SELECT collection_mode_authorized('PLATFORM_HELD') AS ok`;
    if (!row?.ok)
      throw new Error(
        "PLATFORM_HELD is forbidden in production without an approved authorization",
      );
  }
}

// Adaptateur du compte marchand d'un vendeur (identifiants déchiffrés en mémoire seulement).
export async function accountProvider(
  db: Database,
  collection: CollectionSettings,
  env: Record<string, string | undefined>,
  accountId: string,
): Promise<{ provider: PaymentProvider; key: string; active: boolean } | null> {
  const [account] = await asRuntime(
    db,
    {},
    (tx) =>
      tx.$queryRaw<
        {
          provider: string;
          mode: "SANDBOX" | "LIVE" | "MOCK";
          credentials: Buffer;
          keyVersion: number;
          active: boolean;
        }[]
      >`SELECT * FROM store_payment_account(${accountId}::uuid)`,
  );
  if (!account) return null;
  const credentials = openCredentials(
    Buffer.from(account.credentials),
    account.keyVersion,
    collection,
  );
  return {
    key: account.provider,
    active: account.active,
    provider: providerForAccount(
      account.provider,
      account.mode,
      credentials,
      env,
    ),
  };
}

const uuid = { type: "string", format: "uuid" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
} as const;
const anyObject = { type: "object", additionalProperties: true } as const;

export async function collectionRoutes(
  app: FastifyInstance,
  options: {
    db: Database;
    webOrigin: string;
    collection: CollectionSettings;
    env: Record<string, string | undefined>;
  },
) {
  const { db, webOrigin, collection, env } = options;

  // Mode public : le checkout l'affiche (un vendeur par commande en mode direct).
  app.get("/v1/collection", async () => ({ mode: collection.mode }));

  // ---------- Compte marchand du vendeur ----------
  app.get(
    "/v1/stores/:storeId/payment-account",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: uuid },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId } = request.params as { storeId: string };
      const result = await inStore(
        db,
        principal,
        storeId,
        "payments:configure",
        (tx) =>
          tx.storePaymentAccount.findMany({
            where: { storeId },
            select: {
              id: true,
              provider: true,
              mode: true,
              active: true,
              updatedAt: true,
            },
          }),
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      return {
        collectionMode: collection.mode,
        providers: Object.keys(MERCHANT_FIELDS).filter(
          (p) => p !== "mock" || env.PAYMENTS_MOCK_ENABLED === "true",
        ),
        accounts: result.value.map((a) => ({
          ...a,
          updatedAt: a.updatedAt.toISOString(),
        })),
      };
    },
  );

  // Identifiants remplacés en bloc, jamais relus : la réponse ne les contient pas.
  app.post(
    "/v1/stores/:storeId/payment-account",
    {
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["provider", "mode", "credentials"],
          properties: {
            provider: { type: "string", pattern: "^[a-z0-9_-]{2,40}$" },
            mode: { enum: ["SANDBOX", "LIVE", "MOCK"] },
            active: { type: "boolean" },
            credentials: {
              type: "object",
              additionalProperties: { type: "string", maxLength: 500 },
              maxProperties: 10,
            },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as {
        provider: string;
        mode: "SANDBOX" | "LIVE" | "MOCK";
        active?: boolean;
        credentials: Record<string, string>;
      };
      const fields = MERCHANT_FIELDS[body.provider];
      if (
        !fields ||
        !fields.every((f) => (body.credentials[f] ?? "").trim().length >= 4) ||
        Object.keys(body.credentials).some((k) => !fields.includes(k))
      )
        return reply.code(400).send({ error: "invalid_credentials" });
      const credentials = Object.fromEntries(
        fields.map((f) => [f, (body.credentials[f] ?? "").trim()]),
      );
      // L'adaptateur valide le mode (le simulateur est refusé hors développement).
      try {
        providerForAccount(body.provider, body.mode, credentials, env);
      } catch {
        return reply.code(400).send({ error: "invalid_credentials" });
      }
      if (!collection.keys.has(collection.currentKeyVersion))
        return reply.code(409).send({ error: "accounts_disabled" });
      const { sealed, keyVersion } = sealCredentials(credentials, collection);
      const result = await inStore(
        db,
        principal,
        storeId,
        "payments:configure",
        async (tx, ctx) => {
          const existing = await tx.storePaymentAccount.findUnique({
            where: {
              storeId_provider: { storeId, provider: body.provider },
            },
          });
          const data = {
            mode: body.mode,
            credentials: new Uint8Array(sealed),
            keyVersion,
            active: body.active ?? true,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          };
          const account = existing
            ? await tx.storePaymentAccount.update({
                where: { id: existing.id },
                data: { ...data, version: { increment: 1 } },
              })
            : await tx.storePaymentAccount.create({
                data: {
                  ...data,
                  tenantId: ctx.tenantId,
                  storeId,
                  provider: body.provider,
                },
              });
          await tx.auditLog.create({
            data: {
              tenantId: ctx.tenantId,
              actorId: ctx.userId,
              action: "store.payment_account.update",
              resourceId: storeId,
              requestId: request.id,
              // Jamais les identifiants : seulement ce qui a changé.
              detail: {
                provider: body.provider,
                mode: body.mode,
                active: account.active,
              },
            },
          });
          return account;
        },
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      return {
        id: result.value.id,
        provider: result.value.provider,
        mode: result.value.mode,
        active: result.value.active,
        // Adresse de notification à déclarer chez le prestataire, propre à ce compte.
        notifyUrl: `${webOrigin}/v1/payments/webhooks/${result.value.provider}/accounts/${result.value.id}`,
      };
    },
  );

  // ---------- Autorisation du mode « plateforme détentrice des fonds » ----------
  app.get(
    "/v1/admin/collection-authorizations",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "finance:review");
      if (!staff) return reply;
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.collectionModeAuthorization.findMany({
            orderBy: { requestedAt: "desc" },
            take: 50,
          }),
      );
      return {
        mode: collection.mode,
        role: staff.role,
        authorizations: rows.map((a) => ({
          id: a.id,
          mode: a.mode,
          agrementReference: a.agrementReference,
          expiresAt: a.expiresAt.toISOString(),
          requestedAt: a.requestedAt.toISOString(),
          approvedAt: a.approvedAt?.toISOString() ?? null,
          revokedAt: a.revokedAt?.toISOString() ?? null,
          requestedByMe: a.requestedBy === staff.principal.userId,
        })),
      };
    },
  );

  app.post(
    "/v1/admin/collection-authorizations",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["mode", "agrementReference", "expiresAt"],
          properties: {
            mode: { enum: ["PLATFORM_HELD", "PSP_ESCROW"] },
            agrementReference: { type: "string", minLength: 5, maxLength: 200 },
            expiresAt: { type: "string", format: "date-time" },
          },
        },
        response: { 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "finance:review");
      if (!staff) return reply;
      if (staff.role !== "ADMIN")
        return reply.code(403).send({ error: "forbidden" });
      const body = request.body as {
        mode: string;
        agrementReference: string;
        expiresAt: string;
      };
      try {
        const [row] = await asRuntime(
          db,
          { userId: staff.principal.userId },
          (tx) =>
            tx.$queryRaw<{ id: string }[]>`
              SELECT request_collection_authorization(${body.mode}::"CollectionMode",
                ${body.agrementReference}, ${new Date(body.expiresAt)}::timestamptz) AS id`,
        );
        return reply.code(201).send({ id: row?.id });
      } catch (err) {
        if (String(err).includes("authorization_expired"))
          return reply.code(400).send({ error: "authorization_expired" });
        throw err;
      }
    },
  );

  app.post(
    "/v1/admin/collection-authorizations/:id/approve",
    {
      schema: {
        params: { type: "object", required: ["id"], properties: { id: uuid } },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "finance:configure");
      if (!staff) return reply;
      const { id } = request.params as { id: string };
      const [row] = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.$queryRaw<{ outcome: string }[]>`
            SELECT approve_collection_authorization(${id}::uuid) AS outcome`,
      );
      const outcome = row?.outcome ?? "not_found";
      const status = {
        approved: 200,
        forbidden: 403,
        not_found: 404,
        same_person: 403,
        already_decided: 409,
        expired: 409,
      }[outcome];
      return status === 200
        ? { outcome }
        : reply.code((status ?? 409) as 409).send({ error: outcome });
    },
  );
}
