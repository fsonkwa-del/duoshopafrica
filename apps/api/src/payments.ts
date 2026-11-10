import {
  applyPaymentEvent,
  asRuntime,
  type Database,
  type ScopedTx,
} from "@duoshop/database";
import { normalizeCameroonPhone, phoneMatchesPrefixes } from "@duoshop/domain";
import {
  type CollectionSettings,
  MOCK_SIGNATURE_HEADER,
  MockPaymentProvider,
  mockEventBody,
  type PaymentProvider,
  type PaymentProviders,
} from "@duoshop/payments";
import type {
  AdminPaymentDTO,
  AdminPaymentMethodDTO,
  AdminProviderEventDTO,
  NextActionDTO,
  PaymentDTO,
  PaymentMethodOptionDTO,
} from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import { accountProvider, defaultCollection } from "./collection";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
  writeLimit,
} from "./guards";
import { requireStaff } from "./staff";

const uuid = { type: "string", format: "uuid" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
} as const;
const anyObject = { type: "object", additionalProperties: true } as const;
const orderParams = {
  type: "object",
  required: ["orderId"],
  properties: { orderId: uuid },
} as const;
const money = (amount: bigint, currency: string) => ({
  amountMinor: amount.toString(),
  currency,
});

type PaymentRow = Awaited<ReturnType<ScopedTx["payment"]["findMany"]>>[number];
type MethodRow = Awaited<
  ReturnType<ScopedTx["paymentMethod"]["findMany"]>
>[number];

export function paymentView(p: PaymentRow): PaymentDTO {
  return {
    id: p.id,
    methodCode: p.methodCode,
    mode: p.mode,
    status: p.status,
    amount: money(p.amountMinor, p.currency),
    payerPhoneHint: p.payerPhone ? `••${p.payerPhone.slice(-2)}` : null,
    // Une action n'a de sens que tant que la tentative est en cours.
    nextAction:
      p.status === "PENDING"
        ? ((p.nextAction as NextActionDTO | null) ?? null)
        : null,
    failureCode: p.failureCode,
    createdAt: p.createdAt.toISOString(),
    settledAt: p.settledAt?.toISOString() ?? null,
  };
}

function adminMethodView(
  m: MethodRow,
  providers: PaymentProviders,
): AdminPaymentMethodDTO {
  return {
    id: m.id,
    code: m.code,
    kind: m.kind,
    operator: m.operator,
    provider: m.provider,
    countryCode: m.countryCode,
    currency: m.currency,
    labelFr: m.labelFr,
    labelEn: m.labelEn,
    instructionsFr: m.instructionsFr,
    instructionsEn: m.instructionsEn,
    phonePrefixes: m.phonePrefixes,
    minAmountMinor: m.minAmountMinor.toString(),
    maxAmountMinor: m.maxAmountMinor?.toString() ?? null,
    displayOrder: m.displayOrder,
    enabled: m.enabled,
    version: m.version,
    providerMode: providers.get(m.provider)?.mode ?? null,
  };
}

// Configuration d'un moyen de paiement par l'administration (sans le code, immuable).
const methodFields = {
  kind: { enum: ["MOBILE_MONEY", "CARD", "BANK_TRANSFER", "WALLET"] },
  operator: { type: "string", pattern: "^([A-Z0-9_]{2,30})?$" },
  provider: { type: "string", pattern: "^[a-z0-9_-]{2,40}$" },
  countryCode: { type: "string", pattern: "^[A-Z]{2}$" },
  currency: { type: "string", pattern: "^[A-Z]{3}$" },
  labelFr: { type: "string", minLength: 1, maxLength: 80 },
  labelEn: { type: "string", minLength: 1, maxLength: 80 },
  instructionsFr: { type: "string", maxLength: 300 },
  instructionsEn: { type: "string", maxLength: 300 },
  phonePrefixes: {
    type: "array",
    maxItems: 20,
    uniqueItems: true,
    items: { type: "string", pattern: "^\\+[1-9][0-9]{1,7}$" },
  },
  minAmountMinor: { type: "string", pattern: "^[1-9][0-9]{0,15}$" },
  maxAmountMinor: { type: "string", pattern: "^([1-9][0-9]{0,15})?$" },
  displayOrder: { type: "integer", minimum: 0, maximum: 10000 },
  enabled: { type: "boolean" },
} as const;
const requiredFields = [
  "kind",
  "provider",
  "countryCode",
  "currency",
  "labelFr",
  "labelEn",
  "minAmountMinor",
  "enabled",
] as const;
interface MethodBody {
  kind: "MOBILE_MONEY" | "CARD" | "BANK_TRANSFER" | "WALLET";
  operator?: string;
  provider: string;
  countryCode: string;
  currency: string;
  labelFr: string;
  labelEn: string;
  instructionsFr?: string;
  instructionsEn?: string;
  phonePrefixes?: string[];
  minAmountMinor: string;
  maxAmountMinor?: string;
  displayOrder?: number;
  enabled: boolean;
}
function methodData(b: MethodBody) {
  return {
    kind: b.kind,
    operator: b.operator || null,
    provider: b.provider,
    countryCode: b.countryCode,
    currency: b.currency,
    labelFr: b.labelFr.trim(),
    labelEn: b.labelEn.trim(),
    instructionsFr: b.instructionsFr?.trim() || null,
    instructionsEn: b.instructionsEn?.trim() || null,
    phonePrefixes: b.phonePrefixes ?? [],
    minAmountMinor: BigInt(b.minAmountMinor),
    maxAmountMinor: b.maxAmountMinor ? BigInt(b.maxAmountMinor) : null,
    displayOrder: b.displayOrder ?? 100,
    enabled: b.enabled,
  };
}
// Valeurs JSON (BigInt en chaînes) pour l'historique de configuration.
const auditable = ({ createdAt, updatedAt, ...m }: MethodRow) => ({
  ...m,
  minAmountMinor: m.minAmountMinor.toString(),
  maxAmountMinor: m.maxAmountMinor?.toString() ?? null,
});

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "P2002"
  );
}

export async function paymentRoutes(
  app: FastifyInstance,
  options: {
    db: Database;
    webOrigin: string;
    providers: PaymentProviders;
    collection?: CollectionSettings;
    env?: Record<string, string | undefined>;
  },
) {
  const { db, webOrigin, providers } = options;
  const collection = options.collection ?? defaultCollection;
  const env = options.env ?? process.env;
  const direct = collection.mode === "DIRECT_SELLER";
  // Mode direct (lot 3) : compte marchand du vendeur de la commande, pour ce prestataire.
  const sellerAccount = async (
    userId: string,
    orderId: string,
    provider: string,
  ) => {
    const [row] = await asRuntime(
      db,
      { userId },
      (tx) =>
        tx.$queryRaw<{ id: string | null }[]>`
        SELECT order_payment_account(${orderId}::uuid, ${provider}) AS id`,
    );
    if (!row?.id) return null;
    const account = await accountProvider(db, collection, env, row.id);
    return account?.active ? { id: row.id, ...account } : null;
  };

  // ---------- Acheteur : moyens proposés pour une commande ----------
  app.get(
    "/v1/orders/:orderId/payment-methods",
    { schema: { params: orderParams, response: refusals } },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { orderId } = request.params as { orderId: string };
      const result = await asRuntime(
        db,
        { userId: principal.userId },
        async (tx) => {
          const order = await tx.order.findUnique({
            where: { id: orderId },
            select: { currency: true, totalMinor: true },
          });
          if (!order) return null;
          const methods = await tx.paymentMethod.findMany({
            where: {
              enabled: true,
              currency: order.currency,
              minAmountMinor: { lte: order.totalMinor },
              OR: [
                { maxAmountMinor: null },
                { maxAmountMinor: { gte: order.totalMinor } },
              ],
            },
            orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          });
          return methods;
        },
      );
      if (!result) return reply.code(404).send({ error: "not_found" });
      // Un moyen n'est proposé que si son adaptateur existe dans cet environnement ; en mode
      // direct, que si le vendeur a un compte marchand actif chez ce prestataire.
      const accounts = new Map<string, PaymentProvider | null>();
      if (direct)
        for (const key of new Set(result.map((m) => m.provider)))
          accounts.set(
            key,
            (await sellerAccount(principal.userId, orderId, key))?.provider ??
              null,
          );
      const methods: PaymentMethodOptionDTO[] = result.flatMap((m) => {
        const provider = direct
          ? accounts.get(m.provider)
          : providers.get(m.provider);
        return provider
          ? [
              {
                code: m.code,
                kind: m.kind,
                operator: m.operator,
                labelFr: m.labelFr,
                labelEn: m.labelEn,
                instructionsFr: m.instructionsFr,
                instructionsEn: m.instructionsEn,
                requiresPhone: m.kind === "MOBILE_MONEY",
                mode: provider.mode,
              },
            ]
          : [];
      });
      return { methods };
    },
  );

  // ---------- Acheteur : ouvrir une tentative de paiement ----------
  app.post(
    "/v1/orders/:orderId/payments",
    {
      config: writeLimit,
      schema: {
        params: orderParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["methodCode", "idempotencyKey"],
          properties: {
            methodCode: { type: "string", pattern: "^[A-Z0-9_]{2,40}$" },
            idempotencyKey: {
              type: "string",
              pattern: "^[A-Za-z0-9_-]{16,64}$",
            },
            payerPhone: { type: "string", maxLength: 32 },
          },
        },
        response: { 200: anyObject, 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { orderId } = request.params as { orderId: string };
      const body = request.body as {
        methodCode: string;
        idempotencyKey: string;
        payerPhone?: string;
      };
      const method = await asRuntime(db, {}, (tx) =>
        tx.paymentMethod.findUnique({ where: { code: body.methodCode } }),
      );
      const account =
        direct && method?.enabled
          ? await sellerAccount(principal.userId, orderId, method.provider)
          : null;
      if (direct && method?.enabled && !account)
        return reply.code(409).send({ error: "seller_account_unavailable" });
      const provider = !method?.enabled
        ? undefined
        : direct
          ? account?.provider
          : providers.get(method.provider);
      if (!method || !provider)
        return reply.code(409).send({ error: "method_unavailable" });
      let phone: string | null = null;
      if (method.kind === "MOBILE_MONEY") {
        phone =
          method.countryCode === "CM"
            ? normalizeCameroonPhone(body.payerPhone ?? "")
            : null;
        if (!phone) return reply.code(400).send({ error: "invalid_phone" });
        if (!phoneMatchesPrefixes(phone, method.phonePrefixes))
          return reply.code(409).send({ error: "phone_operator_mismatch" });
      }
      const [started] = await asRuntime(
        db,
        { userId: principal.userId },
        (tx) =>
          tx.$queryRaw<{ payment_id: string | null; outcome: string }[]>`
          SELECT * FROM start_payment(${orderId}::uuid, ${method.code}, ${method.provider},
            ${provider.mode}::"PaymentMode", ${body.idempotencyKey}, ${phone},
            ${collection.mode}::"CollectionMode", ${account?.id ?? null}::uuid)`,
      );
      const outcome = started?.outcome ?? "not_found";
      if (outcome === "not_found")
        return reply.code(404).send({ error: "not_found" });
      if (outcome === "conflict")
        return reply.code(409).send({ error: "idempotency_conflict" });
      // Autres refus métier : not_payable, order_expired, method_unavailable, payment_in_progress.
      const paymentId = started?.payment_id;
      if (!paymentId || (outcome !== "created" && outcome !== "replayed"))
        return reply.code(409).send({ error: outcome });
      const load = () =>
        asRuntime(db, { userId: principal.userId }, (tx) =>
          tx.payment.findUniqueOrThrow({ where: { id: paymentId } }),
        );
      if (outcome === "replayed")
        return reply.code(200).send(paymentView(await load()));

      const payment = await load();
      let failure: string | null = null;
      let initiated: { reference: string; nextAction: NextActionDTO } | null =
        null;
      try {
        const result = await provider.initiate({
          kind: method.kind,
          // Adresses publiques : passent par l'origine du site (réécriture /v1 vers l'API).
          notifyUrl: account
            ? `${webOrigin}/v1/payments/webhooks/${provider.key}/accounts/${account.id}`
            : `${webOrigin}/v1/payments/webhooks/${provider.key}`,
          returnUrl: `${webOrigin}/v1/payments/return?${new URLSearchParams({ order: orderId })}`,
          paymentId,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          methodCode: payment.methodCode,
          payerPhone: phone,
          description: `DuoShop ${orderId.slice(0, 8).toUpperCase()}`,
        });
        if (result.ok)
          initiated = {
            reference: result.providerReference,
            nextAction: result.nextAction,
          };
        else failure = result.failureCode;
      } catch (err) {
        // Issue inconnue chez le prestataire : la tentative est close localement ;
        // un succès tardif reçu par webhook sera tout de même honoré ou signalé.
        request.log.warn(
          { err, provider: method.provider },
          "payment initiation failed",
        );
        failure = "provider_error";
      }
      await asRuntime(db, { userId: principal.userId }, (tx) =>
        initiated
          ? tx.$queryRaw`SELECT record_payment_initiation(${paymentId}::uuid,
              ${initiated.reference}, ${JSON.stringify(initiated.nextAction)}::jsonb, NULL)`
          : tx.$queryRaw`SELECT record_payment_initiation(${paymentId}::uuid,
              NULL, NULL, ${failure})`,
      );
      return reply.code(201).send(paymentView(await load()));
    },
  );

  // ---------- Webhooks prestataires : corps brut, signature vérifiée avant toute écriture ----------
  await app.register(async (hooks) => {
    // Corps brut conservé : JSON (signatures HMAC) ou formulaire (notifications CinetPay).
    for (const type of [
      "application/json",
      "application/x-www-form-urlencoded",
    ])
      hooks.addContentTypeParser(
        type,
        { parseAs: "buffer", bodyLimit: 65536 },
        (_request, body, done) => done(null, body),
      );
    for (const path of [
      "/v1/payments/webhooks/:provider",
      "/v1/payments/webhooks/:provider/accounts/:accountId",
    ])
      hooks.post(
        path,
        {
          config: { rateLimit: { max: 600, timeWindow: 60_000 } },
          schema: {
            params: {
              type: "object",
              required: ["provider"],
              properties: {
                provider: { type: "string", pattern: "^[a-z0-9_-]{2,40}$" },
                accountId: uuid,
              },
            },
          },
        },
        async (request, reply) => {
          const { provider: key, accountId } = request.params as {
            provider: string;
            accountId?: string;
          };
          // Compte vendeur (mode direct) : adaptateur construit avec ses identifiants ; un compte
          // désactivé reçoit encore les notifications de ses paiements en cours.
          const account = accountId
            ? await accountProvider(db, collection, env, accountId).catch(
                () => null,
              )
            : null;
          if (accountId && account?.key !== key)
            return reply.code(404).send({ error: "not_found" });
          const provider = account ? account.provider : providers.get(key);
          if (!provider) return reply.code(404).send({ error: "not_found" });
          const raw = request.body;
          if (!Buffer.isBuffer(raw))
            return reply.code(400).send({ error: "invalid_request" });
          const verified = await provider.verifyWebhook(raw, request.headers);
          if (!verified.ok) {
            request.log.warn(
              { provider: key, reason: verified.reason },
              "payment webhook rejected",
            );
            return reply
              .code(verified.reason === "malformed" ? 400 : 401)
              .send({ error: "invalid_signature" });
          }
          const e = verified.event;
          // Persistance et effet dans une seule transaction ; l'ACK suit le COMMIT.
          const outcome = await applyPaymentEvent(
            db,
            key,
            e,
            raw,
            accountId ?? null,
          );
          request.log.info(
            { provider: key, eventId: e.eventId, outcome },
            "payment webhook processed",
          );
          return { received: true, outcome };
        },
      );
  });

  // ---------- Retour du payeur depuis la page du prestataire (GET ou POST) ----------
  // Simple redirection vers la commande : le statut affiché est relu sur le serveur, jamais déduit
  // de ce retour. Aucun paramètre du prestataire n'est interprété.
  await app.register(async (back) => {
    back.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 16384 },
      (_request, _body, done) => done(null, {}),
    );
    back.route({
      method: ["GET", "POST"],
      url: "/v1/payments/return",
      schema: {
        querystring: {
          type: "object",
          required: ["order"],
          properties: { order: uuid },
        },
      },
      handler: async (request, reply) => {
        const { order } = request.query as { order: string };
        return reply.redirect(`${webOrigin}/fr/orders/${order}`, 303);
      },
    });
  });

  // ---------- Mode MOCK uniquement : simulateur de validation sur téléphone ----------
  // Le simulateur signe un événement et l'injecte dans le vrai point d'entrée webhook :
  // vérification, idempotence et effets sont exactement ceux d'un prestataire.
  const mock = providers.get("mock");
  if (
    mock instanceof MockPaymentProvider ||
    (direct && env.PAYMENTS_MOCK_ENABLED === "true")
  )
    app.post(
      "/v1/payments/:paymentId/simulate",
      {
        schema: {
          params: {
            type: "object",
            required: ["paymentId"],
            properties: { paymentId: uuid },
          },
          body: {
            type: "object",
            additionalProperties: false,
            required: ["outcome"],
            properties: { outcome: { enum: ["SUCCEEDED", "FAILED"] } },
          },
          response: { 200: anyObject, ...refusals },
        },
      },
      async (request, reply) => {
        if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
        const principal = await requirePrincipal(db, request, reply);
        if (!principal) return reply;
        const { paymentId } = request.params as { paymentId: string };
        const { outcome } = request.body as {
          outcome: "SUCCEEDED" | "FAILED";
        };
        const payment = await asRuntime(
          db,
          { userId: principal.userId },
          (tx) => tx.payment.findUnique({ where: { id: paymentId } }),
        );
        if (payment?.provider !== "mock")
          return reply.code(404).send({ error: "not_found" });
        const signer = payment.storeAccountId
          ? (await accountProvider(db, collection, env, payment.storeAccountId))
              ?.provider
          : mock;
        if (!(signer instanceof MockPaymentProvider))
          return reply.code(404).send({ error: "not_found" });
        if (payment.status !== "PENDING" || !payment.providerReference)
          return reply.code(409).send({ error: "not_pending" });
        const body = mockEventBody({
          paymentId,
          providerReference: payment.providerReference,
          status: outcome,
          amountMinor: payment.amountMinor,
          currency: payment.currency,
          ...(outcome === "FAILED" ? { failureCode: "declined_by_payer" } : {}),
        });
        const response = await app.inject({
          method: "POST",
          url: payment.storeAccountId
            ? `/v1/payments/webhooks/mock/accounts/${payment.storeAccountId}`
            : "/v1/payments/webhooks/mock",
          headers: {
            "content-type": "application/json",
            [MOCK_SIGNATURE_HEADER]: signer.sign(body),
          },
          payload: body,
        });
        if (response.statusCode !== 200)
          throw new Error(`mock webhook failed: ${response.statusCode}`);
        return { outcome: response.json<{ outcome: string }>().outcome };
      },
    );

  // ---------- Administration : moyens de paiement par opérateur ----------
  app.get(
    "/v1/admin/payment-methods",
    { schema: { response: refusals } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "payment:review");
      if (!staff) return reply;
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.paymentMethod.findMany({
            orderBy: [{ displayOrder: "asc" }, { code: "asc" }],
          }),
      );
      return {
        methods: rows.map((m) => adminMethodView(m, providers)),
        // Adaptateurs disponibles dans cet environnement (aucun secret exposé).
        providers: [...providers.values()].map((p) => ({
          key: p.key,
          mode: p.mode,
        })),
      };
    },
  );

  app.post(
    "/v1/admin/payment-methods",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["code", ...requiredFields],
          properties: {
            code: { type: "string", pattern: "^[A-Z0-9_]{2,40}$" },
            ...methodFields,
          },
        },
        response: { 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "payment:configure");
      if (!staff) return reply;
      const body = request.body as MethodBody & { code: string };
      const data = methodData(body);
      if (
        data.maxAmountMinor !== null &&
        data.maxAmountMinor < data.minAmountMinor
      )
        return reply.code(400).send({ error: "invalid_amount_range" });
      try {
        const created = await asRuntime(
          db,
          { userId: staff.principal.userId },
          async (tx) => {
            const row = await tx.paymentMethod.create({
              data: { code: body.code, ...data },
            });
            await tx.configAudit.create({
              data: {
                actorId: staff.principal.userId,
                entity: "PaymentMethod",
                entityId: row.id,
                action: "create",
                after: auditable(row),
              },
            });
            return row;
          },
        );
        return reply.code(201).send(adminMethodView(created, providers));
      } catch (err) {
        if (isUniqueViolation(err))
          return reply.code(409).send({ error: "code_taken" });
        throw err;
      }
    },
  );

  app.post(
    "/v1/admin/payment-methods/:methodId",
    {
      schema: {
        params: {
          type: "object",
          required: ["methodId"],
          properties: { methodId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [...requiredFields, "expectedVersion"],
          properties: {
            ...methodFields,
            expectedVersion: { type: "integer", minimum: 0 },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "payment:configure");
      if (!staff) return reply;
      const { methodId } = request.params as { methodId: string };
      const body = request.body as MethodBody & { expectedVersion: number };
      const data = methodData(body);
      if (
        data.maxAmountMinor !== null &&
        data.maxAmountMinor < data.minAmountMinor
      )
        return reply.code(400).send({ error: "invalid_amount_range" });
      const result = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => {
          const before = await tx.paymentMethod.findUnique({
            where: { id: methodId },
          });
          if (!before) return "not_found" as const;
          // Écriture conditionnelle : deux administrateurs ne s'écrasent pas en silence.
          const { count } = await tx.paymentMethod.updateMany({
            where: { id: methodId, version: body.expectedVersion },
            data: { ...data, version: { increment: 1 }, updatedAt: new Date() },
          });
          if (count === 0) return "version_conflict" as const;
          const after = await tx.paymentMethod.findUniqueOrThrow({
            where: { id: methodId },
          });
          await tx.configAudit.create({
            data: {
              actorId: staff.principal.userId,
              entity: "PaymentMethod",
              entityId: methodId,
              action:
                before.enabled === after.enabled
                  ? "update"
                  : after.enabled
                    ? "enable"
                    : "disable",
              before: auditable(before),
              after: auditable(after),
            },
          });
          return after;
        },
      );
      if (result === "not_found")
        return reply.code(404).send({ error: "not_found" });
      if (result === "version_conflict")
        return reply.code(409).send({ error: "version_conflict" });
      return adminMethodView(result, providers);
    },
  );

  // ---------- Administration : paiements à traiter et événements suspects ----------
  app.get(
    "/v1/admin/payments",
    { schema: { response: refusals } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "payment:review");
      if (!staff) return reply;
      const { payments, events, refunds } = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => ({
          payments: await tx.payment.findMany({
            where: { attentionReason: { not: null } },
            orderBy: { updatedAt: "desc" },
            take: 100,
          }),
          events: await tx.providerEvent.findMany({
            where: { outcome: { in: ["QUARANTINED", "ORPHAN"] } },
            orderBy: { receivedAt: "desc" },
            take: 100,
          }),
          refunds: await tx.refund.findMany({
            where: { status: "PENDING_PROVIDER" },
            orderBy: { createdAt: "asc" },
            take: 100,
          }),
        }),
      );
      return {
        payments: payments.map(
          (p): AdminPaymentDTO => ({
            id: p.id,
            orderId: p.orderId,
            methodCode: p.methodCode,
            provider: p.provider,
            mode: p.mode,
            status: p.status,
            amount: money(p.amountMinor, p.currency),
            providerReference: p.providerReference,
            attentionReason: p.attentionReason,
            createdAt: p.createdAt.toISOString(),
            settledAt: p.settledAt?.toISOString() ?? null,
          }),
        ),
        // Remboursements décidés (litiges), à exécuter chez le prestataire.
        refunds: refunds.map((r) => ({
          id: r.id,
          orderId: r.orderId,
          paymentId: r.paymentId,
          amount: money(r.amountMinor, r.currency),
          createdAt: r.createdAt.toISOString(),
        })),
        events: events.map(
          (e): AdminProviderEventDTO => ({
            id: e.id,
            provider: e.provider,
            eventId: e.eventId,
            paymentId: e.paymentId,
            reportedStatus: e.reportedStatus,
            amount: money(e.amountMinor, e.currency),
            outcome: e.outcome,
            detail: e.detail,
            receivedAt: e.receivedAt.toISOString(),
          }),
        ),
      };
    },
  );
}
