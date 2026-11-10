import { asRuntime, type Database } from "@duoshop/database";
import { parsePriceMinor } from "@duoshop/domain";
import type { DeliveryZoneDTO } from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { requireStaff } from "./staff";
import { inStore } from "./store-scope";

// Quartiers de livraison et tarifs par quartier (lot 7, ADR 0015).
const uuid = { type: "string", format: "uuid" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
} as const;
const anyObject = { type: "object", additionalProperties: true } as const;
const zoneView = (z: DeliveryZoneDTO): DeliveryZoneDTO => ({
  id: z.id,
  slug: z.slug,
  city: z.city,
  name: z.name,
  position: z.position,
  active: z.active,
});

export async function zoneRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  // Liste publique : formulaires d'adresse et tarifs vendeur.
  app.get(
    "/v1/delivery-zones",
    { schema: { response: { 200: anyObject } } },
    async () => {
      const zones = await asRuntime(db, {}, (tx) =>
        tx.deliveryZone.findMany({
          where: { active: true },
          orderBy: [{ city: "asc" }, { position: "asc" }, { name: "asc" }],
        }),
      );
      return { zones: zones.map(zoneView) };
    },
  );

  // ---------- Administration ----------
  app.get(
    "/v1/admin/delivery-zones",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "taxonomy:manage");
      if (!staff) return reply;
      const zones = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.deliveryZone.findMany({
            orderBy: [{ city: "asc" }, { position: "asc" }, { name: "asc" }],
          }),
      );
      return { zones: zones.map(zoneView) };
    },
  );

  app.post(
    "/v1/admin/delivery-zones",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "city", "name"],
          properties: {
            slug: {
              type: "string",
              pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
              maxLength: 60,
            },
            city: { type: "string", minLength: 2, maxLength: 80 },
            name: { type: "string", minLength: 2, maxLength: 80 },
            position: { type: "integer", minimum: 0, maximum: 10000 },
          },
        },
        response: { 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "taxonomy:manage");
      if (!staff) return reply;
      const body = request.body as {
        slug: string;
        city: string;
        name: string;
        position?: number;
      };
      const created = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => {
          if (await tx.deliveryZone.count({ where: { slug: body.slug } }))
            return null;
          const zone = await tx.deliveryZone.create({
            data: {
              slug: body.slug,
              city: body.city.trim(),
              name: body.name.trim(),
              position: body.position ?? 100,
            },
          });
          await tx.configAudit.create({
            data: {
              actorId: staff.principal.userId,
              entity: "DeliveryZone",
              entityId: zone.id,
              action: "create",
              after: { slug: zone.slug, city: zone.city, name: zone.name },
            },
          });
          return zone;
        },
      );
      if (!created) return reply.code(409).send({ error: "slug_taken" });
      return reply.code(201).send(zoneView(created));
    },
  );

  app.post(
    "/v1/admin/delivery-zones/:zoneId",
    {
      schema: {
        params: {
          type: "object",
          required: ["zoneId"],
          properties: { zoneId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string", minLength: 2, maxLength: 80 },
            position: { type: "integer", minimum: 0, maximum: 10000 },
            active: { type: "boolean" },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "taxonomy:manage");
      if (!staff) return reply;
      const { zoneId } = request.params as { zoneId: string };
      const body = request.body as {
        name?: string;
        position?: number;
        active?: boolean;
      };
      const updated = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => {
          const before = await tx.deliveryZone.findUnique({
            where: { id: zoneId },
          });
          if (!before) return null;
          const zone = await tx.deliveryZone.update({
            where: { id: zoneId },
            data: {
              ...(body.name ? { name: body.name.trim() } : {}),
              ...(body.position !== undefined
                ? { position: body.position }
                : {}),
              ...(body.active !== undefined ? { active: body.active } : {}),
            },
          });
          await tx.configAudit.create({
            data: {
              actorId: staff.principal.userId,
              entity: "DeliveryZone",
              entityId: zone.id,
              action: "update",
              before: { name: before.name, active: before.active },
              after: { name: zone.name, active: zone.active },
            },
          });
          return zone;
        },
      );
      if (!updated) return reply.code(404).send({ error: "not_found" });
      return zoneView(updated);
    },
  );

  // ---------- Tarifs par quartier d'une boutique ----------
  // Remplace l'ensemble : un quartier absent suit le tarif « toutes zones » de la boutique.
  app.post(
    "/v1/stores/:storeId/zone-fees",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["fees"],
          properties: {
            fees: {
              type: "array",
              maxItems: 200,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["zoneId", "feeMinor"],
                properties: {
                  zoneId: uuid,
                  // null : quartier non desservi.
                  feeMinor: {
                    anyOf: [
                      { type: "string", pattern: "^[0-9]{1,9}$" },
                      { type: "null" },
                    ],
                  },
                },
              },
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
      const { fees } = request.body as {
        fees: { zoneId: string; feeMinor: string | null }[];
      };
      if (new Set(fees.map((f) => f.zoneId)).size !== fees.length)
        return reply.code(400).send({ error: "invalid_request" });
      const parsed = fees.map((f) => ({
        zoneId: f.zoneId,
        feeMinor:
          f.feeMinor === null
            ? null
            : f.feeMinor === "0"
              ? 0n
              : parsePriceMinor(f.feeMinor),
      }));
      if (
        parsed.some((f, i) => fees[i]?.feeMinor !== null && f.feeMinor === null)
      )
        return reply.code(400).send({ error: "invalid_request" });
      const result = await inStore(
        db,
        principal,
        storeId,
        "store:configure",
        async (tx, ctx) => {
          const known = await tx.deliveryZone.count({
            where: { id: { in: parsed.map((f) => f.zoneId) }, active: true },
          });
          if (known !== parsed.length) return false;
          await tx.storeZoneFee.deleteMany({ where: { storeId } });
          if (parsed.length)
            await tx.storeZoneFee.createMany({
              data: parsed.map((f) => ({
                tenantId: ctx.tenantId,
                storeId,
                zoneId: f.zoneId,
                feeMinor: f.feeMinor,
              })),
            });
          await tx.auditLog.create({
            data: {
              tenantId: ctx.tenantId,
              actorId: ctx.userId,
              action: "store.zone_fees.update",
              resourceId: storeId,
              requestId: request.id,
              detail: {
                fees: parsed.map((f) => ({
                  zoneId: f.zoneId,
                  feeMinor: f.feeMinor?.toString() ?? null,
                })),
              },
            },
          });
          return true;
        },
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      if (!result.value) return reply.code(404).send({ error: "zone_unknown" });
      return { count: parsed.length };
    },
  );
}
