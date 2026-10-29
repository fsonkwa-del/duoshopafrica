import { asRuntime, type Database } from "@duoshop/database";
import type {
  CommissionRuleDTO,
  EarningsDTO,
  FinanceReportDTO,
} from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { requireStaff } from "./staff";
import { inStore } from "./store-scope";

const uuid = { type: "string", format: "uuid" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
} as const;
const anyObject = { type: "object", additionalProperties: true } as const;
// Une règle ne s'applique qu'aux paiements futurs : pas de date d'effet passée (tolérance d'horloge).
const CLOCK_SKEW_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;

type RuleRow = Awaited<
  ReturnType<
    Parameters<
      Parameters<Database["$transaction"]>[0]
    >[0]["commissionRule"]["findMany"]
  >
>[number];
const ruleView = (
  r: RuleRow,
  stores: Map<string, string>,
): CommissionRuleDTO => ({
  id: r.id,
  storeId: r.storeId,
  storeName: r.storeId ? (stores.get(r.storeId) ?? null) : null,
  basisPoints: r.basisPoints,
  label: r.label,
  validFrom: r.validFrom.toISOString(),
  validTo: r.validTo?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

export async function financeRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  // ---------- Règles de commission (finance seule pour écrire) ----------
  app.get(
    "/v1/admin/commission-rules",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "finance:review");
      if (!staff) return reply;
      const { rules, stores } = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => ({
          rules: await tx.commissionRule.findMany({
            orderBy: [{ validFrom: "desc" }],
            take: 200,
          }),
          stores: await tx.store.findMany({
            select: { id: true, name: true, slug: true },
            orderBy: { name: "asc" },
          }),
        }),
      );
      const names = new Map(stores.map((s) => [s.id, s.name]));
      return {
        rules: rules.map((r) => ruleView(r, names)),
        stores,
        canConfigure: staff.role === "FINANCE",
      };
    },
  );

  app.post(
    "/v1/admin/commission-rules",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["basisPoints", "label", "validFrom"],
          properties: {
            storeId: uuid,
            basisPoints: { type: "integer", minimum: 0, maximum: 10000 },
            label: { type: "string", minLength: 3, maxLength: 120 },
            validFrom: { type: "string", format: "date-time" },
          },
        },
        response: { 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "finance:configure");
      if (!staff) return reply;
      const body = request.body as {
        storeId?: string;
        basisPoints: number;
        label: string;
        validFrom: string;
      };
      const validFrom = new Date(body.validFrom);
      if (validFrom.getTime() < Date.now() - CLOCK_SKEW_MS)
        return reply.code(400).send({ error: "retroactive_rule" });
      const created = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => {
          if (
            body.storeId &&
            !(await tx.store.count({ where: { id: body.storeId } }))
          )
            return null;
          const rule = await tx.commissionRule.create({
            data: {
              storeId: body.storeId ?? null,
              basisPoints: body.basisPoints,
              label: body.label.trim(),
              validFrom,
              createdBy: staff.principal.userId,
            },
          });
          await tx.configAudit.create({
            data: {
              actorId: staff.principal.userId,
              entity: "CommissionRule",
              entityId: rule.id,
              action: "create",
              after: {
                storeId: rule.storeId,
                basisPoints: rule.basisPoints,
                label: rule.label,
                validFrom: rule.validFrom.toISOString(),
              },
            },
          });
          return rule;
        },
      );
      if (!created) return reply.code(404).send({ error: "store_not_found" });
      return reply.code(201).send(ruleView(created, new Map()));
    },
  );

  // Fin d'une règle (ex. fin d'une remise négociée) : seule modification permise, jamais rétroactive.
  app.post(
    "/v1/admin/commission-rules/:ruleId/close",
    {
      schema: {
        params: {
          type: "object",
          required: ["ruleId"],
          properties: { ruleId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["validTo"],
          properties: { validTo: { type: "string", format: "date-time" } },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "finance:configure");
      if (!staff) return reply;
      const { ruleId } = request.params as { ruleId: string };
      const validTo = new Date((request.body as { validTo: string }).validTo);
      if (validTo.getTime() < Date.now() - CLOCK_SKEW_MS)
        return reply.code(400).send({ error: "retroactive_rule" });
      const outcome = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => {
          const rule = await tx.commissionRule.findUnique({
            where: { id: ruleId },
          });
          if (!rule) return "not_found" as const;
          if (rule.validTo) return "already_closed" as const;
          if (validTo <= rule.validFrom) return "invalid_range" as const;
          await tx.commissionRule.update({
            where: { id: ruleId },
            data: { validTo },
          });
          await tx.configAudit.create({
            data: {
              actorId: staff.principal.userId,
              entity: "CommissionRule",
              entityId: ruleId,
              action: "close",
              after: { validTo: validTo.toISOString() },
            },
          });
          return "closed" as const;
        },
      );
      if (outcome === "not_found")
        return reply.code(404).send({ error: "not_found" });
      if (outcome !== "closed") return reply.code(409).send({ error: outcome });
      return { validTo: validTo.toISOString() };
    },
  );

  // ---------- Rapprochement ----------
  app.get(
    "/v1/admin/finance",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            from: { type: "string", format: "date" },
            to: { type: "string", format: "date" },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "finance:review");
      if (!staff) return reply;
      const query = request.query as { from?: string; to?: string };
      // Jours calendaires de Douala (UTC+1, sans heure d'été) ; 7 derniers jours par défaut.
      const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
      const toDay = query.to ?? today;
      const fromDay =
        query.from ??
        new Date(Date.parse(`${toDay}T00:00:00Z`) - 6 * DAY_MS)
          .toISOString()
          .slice(0, 10);
      const from = new Date(`${fromDay}T00:00:00+01:00`);
      const to = new Date(Date.parse(`${toDay}T00:00:00+01:00`) + DAY_MS);
      if (!(from < to) || to.getTime() - from.getTime() > 92 * DAY_MS)
        return reply.code(400).send({ error: "invalid_period" });
      const [row] = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.$queryRaw<{ report: Omit<FinanceReportDTO, "from" | "to"> }[]>`
            SELECT finance_report(${from}, ${to}) AS report`,
      );
      return { from: fromDay, to: toDay, ...row?.report };
    },
  );

  // ---------- Vendeur : ce qui lui est dû (aucun reversement automatique à ce stade) ----------
  app.get(
    "/v1/stores/:storeId/earnings",
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
        "earnings:read",
        (tx) =>
          tx.sellerOrder.findMany({
            where: { storeId, status: "PAID" },
            orderBy: { createdAt: "desc" },
            take: 200,
            include: { items: { select: { currency: true }, take: 1 } },
          }),
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      let pending = 0n;
      let earned = 0n;
      let currency = "XAF";
      const lines = result.value.map((so) => {
        currency = so.items[0]?.currency ?? currency;
        const net = so.sellerNetMinor ?? 0n;
        if (so.fulfilmentStatus === "DELIVERED") earned += net;
        else pending += net;
        const money = (v: bigint | null) =>
          v === null ? null : { amountMinor: v.toString(), currency };
        return {
          sellerOrderId: so.id,
          reference: so.orderId.slice(0, 8).toUpperCase(),
          createdAt: so.createdAt.toISOString(),
          fulfilmentStatus: so.fulfilmentStatus,
          gross: money(so.itemsTotalMinor + so.deliveryFeeMinor),
          commissionBasisPoints: so.commissionBasisPoints,
          commission: money(so.commissionMinor),
          net: money(so.sellerNetMinor),
        };
      });
      const body: EarningsDTO = {
        lines,
        pending: { amountMinor: pending.toString(), currency },
        earned: { amountMinor: earned.toString(), currency },
      };
      return body;
    },
  );
}
