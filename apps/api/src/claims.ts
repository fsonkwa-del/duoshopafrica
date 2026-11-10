import { asRuntime, type Database, type ScopedTx } from "@duoshop/database";
import type { ClaimDTO } from "@duoshop/types";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
  writeLimit,
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
const claimParams = {
  type: "object",
  required: ["claimId"],
  properties: { claimId: uuid },
} as const;
const money = (amount: bigint, currency: string) => ({
  amountMinor: amount.toString(),
  currency,
});

export const claimInclude = {
  items: { include: { orderItem: { select: { title: true, label: true } } } },
  events: { orderBy: { createdAt: "asc" } },
  refund: true,
  sellerOrder: { select: { storeName: true } },
} as const;
type ClaimRow = Awaited<ReturnType<ScopedTx["claim"]["findMany"]>>[number] & {
  items: (Awaited<ReturnType<ScopedTx["claimItem"]["findMany"]>>[number] & {
    orderItem: { title: string; label: string };
  })[];
  events: Awaited<ReturnType<ScopedTx["claimEvent"]["findMany"]>>;
  refund: Awaited<ReturnType<ScopedTx["refund"]["findMany"]>>[number] | null;
  sellerOrder?: { storeName: string } | null;
};

export function claimView(c: ClaimRow): ClaimDTO {
  return {
    id: c.id,
    sellerOrderId: c.sellerOrderId,
    orderId: c.orderId,
    storeName: c.sellerOrder?.storeName ?? null,
    reason: c.reason,
    description: c.description,
    status: c.status,
    amount: money(c.amountMinor, c.currency),
    version: c.version,
    createdAt: c.createdAt.toISOString(),
    items: c.items.map((i) => ({
      title: i.orderItem.title,
      label: i.orderItem.label,
      quantity: i.quantity,
      amount: money(i.amountMinor, c.currency),
    })),
    events: c.events.map((e) => ({
      status: e.status,
      actor: e.actor,
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
    refund: c.refund
      ? {
          amount: money(c.refund.amountMinor, c.refund.currency),
          status: c.refund.status,
        }
      : null,
  };
}

// Issues métier des fonctions SQL : 404 si introuvable, sinon 409 avec le code.
async function outcome(reply: FastifyReply, code: string, ok: () => unknown) {
  if (code === "ok") return ok();
  if (code === "not_found") return reply.code(404).send({ error: "not_found" });
  if (code === "forbidden") return reply.code(403).send({ error: code });
  return reply.code(409).send({ error: code });
}

export async function claimRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  // ---------- Acheteur ----------
  app.post(
    "/v1/orders/:orderId/claims",
    {
      config: writeLimit,
      schema: {
        params: {
          type: "object",
          required: ["orderId"],
          properties: { orderId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "sellerOrderId",
            "reason",
            "description",
            "items",
            "idempotencyKey",
          ],
          properties: {
            sellerOrderId: uuid,
            reason: {
              enum: [
                "DAMAGED",
                "WRONG_ITEM",
                "NOT_AS_DESCRIBED",
                "MISSING_ITEM",
                "OTHER",
              ],
            },
            description: { type: "string", minLength: 10, maxLength: 1000 },
            items: {
              type: "array",
              minItems: 1,
              maxItems: 50,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["orderItemId", "quantity"],
                properties: {
                  orderItemId: uuid,
                  quantity: { type: "integer", minimum: 1, maximum: 99 },
                },
              },
            },
            idempotencyKey: {
              type: "string",
              pattern: "^[A-Za-z0-9_-]{16,64}$",
            },
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
        sellerOrderId: string;
        reason: string;
        description: string;
        items: { orderItemId: string; quantity: number }[];
        idempotencyKey: string;
      };
      const result = await asRuntime(
        db,
        { userId: principal.userId },
        async (tx) => {
          // La sous-commande doit appartenir à la commande citée (et à l'acheteur, via RLS).
          if (
            !(await tx.sellerOrder.count({
              where: { id: body.sellerOrderId, orderId },
            }))
          )
            return { outcome: "not_found", claim: null };
          const [row] = await tx.$queryRaw<
            { claim_id: string | null; outcome: string }[]
          >`SELECT * FROM open_claim(${body.sellerOrderId}::uuid, ${body.reason}::"ClaimReason",
              ${body.description}, ${JSON.stringify(body.items)}::jsonb, ${body.idempotencyKey})`;
          const claim = row?.claim_id
            ? ((await tx.claim.findUnique({
                where: { id: row.claim_id },
                include: claimInclude,
              })) as ClaimRow | null)
            : null;
          return { outcome: row?.outcome ?? "not_found", claim };
        },
      );
      if (result.outcome === "conflict")
        return reply.code(409).send({ error: "idempotency_conflict" });
      if (
        (result.outcome === "created" || result.outcome === "replayed") &&
        result.claim
      )
        return reply
          .code(result.outcome === "created" ? 201 : 200)
          .send(claimView(result.claim));
      return outcome(reply, result.outcome, () => null);
    },
  );

  for (const [path, to] of [
    ["escalate", "ESCALATED"],
    ["withdraw", "WITHDRAWN"],
  ] as const)
    app.post(
      `/v1/claims/:claimId/${path}`,
      {
        schema: {
          params: claimParams,
          response: { 200: anyObject, ...refusals },
        },
      },
      async (request, reply) => {
        if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
        const principal = await requirePrincipal(db, request, reply);
        if (!principal) return reply;
        const { claimId } = request.params as { claimId: string };
        const [row] = await asRuntime(
          db,
          { userId: principal.userId },
          (tx) =>
            tx.$queryRaw<{ outcome: string }[]>`
            SELECT buyer_claim_action(${claimId}::uuid, ${to}::"ClaimStatus") AS outcome`,
        );
        return outcome(reply, row?.outcome ?? "not_found", () => ({
          status: to,
        }));
      },
    );

  // ---------- Vendeur ----------
  app.get(
    "/v1/stores/:storeId/claims",
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
        "order:read",
        async (tx, ctx) => {
          const rows = (await tx.claim.findMany({
            where: { sellerOrder: { storeId } },
            orderBy: { createdAt: "desc" },
            take: 100,
            include: claimInclude,
          })) as ClaimRow[];
          return {
            claims: rows.map(claimView),
            canRespond: ctx.role === "OWNER" || ctx.role === "MANAGER",
          };
        },
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      return result.value;
    },
  );

  app.post(
    "/v1/stores/:storeId/claims/:claimId/respond",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId", "claimId"],
          properties: { storeId: uuid, claimId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["accept", "expectedVersion"],
          properties: {
            accept: { type: "boolean" },
            note: { type: "string", maxLength: 1000 },
            expectedVersion: { type: "integer", minimum: 0 },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId, claimId } = request.params as {
        storeId: string;
        claimId: string;
      };
      const body = request.body as {
        accept: boolean;
        note?: string;
        expectedVersion: number;
      };
      const result = await inStore(
        db,
        principal,
        storeId,
        "claim:respond",
        async (tx) => {
          if (
            !(await tx.claim.count({
              where: { id: claimId, sellerOrder: { storeId } },
            }))
          )
            return "not_found";
          const [row] = await tx.$queryRaw<{ outcome: string }[]>`
            SELECT respond_claim(${claimId}::uuid, ${body.accept}, ${body.note ?? null},
              ${body.expectedVersion}) AS outcome`;
          return row?.outcome ?? "not_found";
        },
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      return outcome(reply, result.value, () => ({
        status: body.accept ? "ACCEPTED" : "REJECTED",
      }));
    },
  );

  // ---------- Plateforme : instruction (support) et médiation (admin) ----------
  app.get(
    "/v1/admin/claims",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: {
              enum: [
                "OPEN",
                "ACCEPTED",
                "REJECTED",
                "ESCALATED",
                "REFUND_APPROVED",
                "CLOSED_NO_REFUND",
                "WITHDRAWN",
              ],
            },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "claim:review");
      if (!staff) return reply;
      const { status = "ESCALATED" } = request.query as {
        status?: ClaimDTO["status"];
      };
      const rows = (await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.claim.findMany({
            where: { status },
            orderBy: { createdAt: "asc" },
            take: 100,
            include: claimInclude,
          }),
      )) as ClaimRow[];
      return {
        status,
        claims: rows.map(claimView),
        canDecide: staff.role === "ADMIN",
      };
    },
  );

  // « /decide » : ancien nom (arbitrage), gardé un lot pour les clients déjà déployés (ADR 0015).
  for (const action of ["mediate", "decide"])
    app.post(
      `/v1/admin/claims/:claimId/${action}`,
      {
        schema: {
          params: claimParams,
          body: {
            type: "object",
            additionalProperties: false,
            required: ["refund", "note"],
            properties: {
              refund: { type: "boolean" },
              note: { type: "string", minLength: 10, maxLength: 1000 },
            },
          },
          response: { 200: anyObject, ...refusals },
        },
      },
      async (request, reply) => {
        if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
        const staff = await requireStaff(db, request, reply, "claim:mediate");
        if (!staff) return reply;
        const { claimId } = request.params as { claimId: string };
        const body = request.body as { refund: boolean; note: string };
        const [row] = await asRuntime(
          db,
          { userId: staff.principal.userId },
          (tx) =>
            tx.$queryRaw<{ outcome: string }[]>`
              SELECT mediate_claim(${claimId}::uuid, ${body.refund}, ${body.note}) AS outcome`,
        );
        return outcome(reply, row?.outcome ?? "not_found", () => ({
          status: body.refund ? "REFUND_APPROVED" : "CLOSED_NO_REFUND",
        }));
      },
    );
}
