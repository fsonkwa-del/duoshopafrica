import { asRuntime, type Database } from "@duoshop/database";
import type { NotificationDTO } from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { inStore } from "./store-scope";

const uuid = { type: "string", format: "uuid" } as const;

export async function fulfilmentRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  // ---------- Vendeur : étape suivante (préparée, en livraison, remise contre code…) ----------
  app.post(
    "/v1/stores/:storeId/orders/:sellerOrderId/fulfilment",
    {
      // Le code à 6 chiffres est aussi borné en base (5 essais par sous-commande).
      config: { rateLimit: { max: 30, timeWindow: 60_000 } },
      schema: {
        params: {
          type: "object",
          required: ["storeId", "sellerOrderId"],
          properties: { storeId: uuid, sellerOrderId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["to", "expectedVersion"],
          properties: {
            to: {
              enum: [
                "READY",
                "OUT_FOR_DELIVERY",
                "DELIVERY_FAILED",
                "DELIVERED",
              ],
            },
            note: { type: "string", maxLength: 300 },
            code: { type: "string", pattern: "^[0-9]{6}$" },
            expectedVersion: { type: "integer", minimum: 0 },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string" } },
          },
          400: error,
          401: error,
          403: error,
          404: error,
          409: error,
        },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId, sellerOrderId } = request.params as {
        storeId: string;
        sellerOrderId: string;
      };
      const body = request.body as {
        to: string;
        note?: string;
        code?: string;
        expectedVersion: number;
      };
      const result = await inStore(
        db,
        principal,
        storeId,
        "order:fulfil",
        async (tx) => {
          // Sous-commande d'une autre boutique du même vendeur : traitée comme inconnue.
          const owned = await tx.sellerOrder.count({
            where: { id: sellerOrderId, storeId },
          });
          if (!owned) return "not_found";
          const [row] = await tx.$queryRaw<{ outcome: string }[]>`
            SELECT advance_fulfilment(${sellerOrderId}::uuid, ${body.to}::"FulfilmentStatus",
              ${body.note ?? null}, ${body.code ?? null}, ${body.expectedVersion}) AS outcome`;
          return row?.outcome ?? "not_found";
        },
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      if (result.value === "not_found")
        return reply.code(404).send({ error: "not_found" });
      if (result.value !== "ok")
        return reply.code(409).send({ error: result.value });
      return { status: body.to };
    },
  );

  // ---------- Notifications dans le site ----------
  app.get(
    "/v1/notifications",
    { schema: { response: { 401: error } } },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { rows, unread } = await asRuntime(
        db,
        { userId: principal.userId },
        async (tx) => ({
          rows: await tx.notification.findMany({
            orderBy: { createdAt: "desc" },
            take: 50,
          }),
          unread: await tx.notification.count({ where: { readAt: null } }),
        }),
      );
      return {
        unread,
        notifications: rows.map(
          (n): NotificationDTO => ({
            id: n.id,
            kind: n.kind,
            orderId: n.orderId,
            data: n.data as Record<string, string>,
            createdAt: n.createdAt.toISOString(),
            read: n.readAt !== null,
          }),
        ),
      };
    },
  );

  app.post(
    "/v1/notifications/read",
    { schema: { response: { 401: error, 403: error } } },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { count } = await asRuntime(
        db,
        { userId: principal.userId },
        (tx) =>
          tx.notification.updateMany({
            where: { readAt: null },
            data: { readAt: new Date() },
          }),
      );
      return { marked: count };
    },
  );
}
