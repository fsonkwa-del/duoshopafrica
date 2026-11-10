import { asRuntime, type Database, enterTenant } from "@duoshop/database";
import { canAccess } from "@duoshop/domain";
import type { MeDTO, StoreDTO } from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { clearSessionCookie } from "./session";

const role = { enum: ["OWNER", "MANAGER", "CATALOG", "FULFILLMENT"] };
const storeSummary = {
  type: "object",
  additionalProperties: false,
  required: ["id", "name", "role"],
  properties: { id: { type: "string" }, name: { type: "string" }, role },
} as const;
// Le motif n'est montré au vendeur que pour un refus ou une suspension, jamais les notes d'approbation.
function verificationView(
  verification: {
    status: StoreDTO["verification"]["status"];
    decisionReason: string | null;
  } | null,
): StoreDTO["verification"] {
  const status = verification?.status ?? "PENDING";
  const visible = status === "REJECTED" || status === "SUSPENDED";
  return {
    status,
    reason: visible ? (verification?.decisionReason ?? null) : null,
  };
}

export async function accountRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  app.get(
    "/v1/me",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["id", "email", "mfa", "platformRole", "stores"],
            properties: {
              id: { type: "string" },
              email: { type: "string" },
              mfa: { type: "boolean" },
              platformRole: {
                anyOf: [
                  { enum: ["ADMIN", "SUPPORT", "FINANCE"] },
                  { type: "null" },
                ],
              },
              stores: { type: "array", items: storeSummary },
            },
          },
          401: error,
        },
      },
    },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      return asRuntime(
        db,
        { userId: principal.userId },
        async (tx): Promise<MeDTO> => {
          const user = await tx.user.findUniqueOrThrow({
            where: { id: principal.userId },
            select: { id: true, email: true },
          });
          const members = await tx.storeMember.findMany({
            where: { userId: principal.userId, active: true },
            select: { tenantId: true, storeId: true, role: true },
          });
          const stores: MeDTO["stores"] = [];
          // Les boutiques ne sont lisibles qu'après entrée explicite dans chaque tenant.
          for (const tenantId of new Set(members.map((m) => m.tenantId))) {
            await enterTenant(tx, tenantId);
            const scoped = members.filter((m) => m.tenantId === tenantId);
            const rows = await tx.store.findMany({
              where: { id: { in: scoped.map((m) => m.storeId) } },
              select: { id: true, name: true },
            });
            for (const row of rows) {
              const member = scoped.find((m) => m.storeId === row.id);
              if (member) stores.push({ ...row, role: member.role });
            }
          }
          const [platform] = await tx.$queryRaw<
            { role: MeDTO["platformRole"] }[]
          >`SELECT app_platform_role() AS role`;
          return {
            ...user,
            mfa: principal.mfa,
            platformRole: platform?.role ?? null,
            stores,
          };
        },
      );
    },
  );

  app.get(
    "/v1/stores/:storeId",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId"],
          properties: { storeId: { type: "string", format: "uuid" } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: [
              ...storeSummary.required,
              "slug",
              "isDemo",
              "tenantStatus",
              "verification",
              "fulfilment",
              "contact",
              "zoneFees",
            ],
            properties: {
              ...storeSummary.properties,
              slug: { type: "string" },
              isDemo: { type: "boolean" },
              tenantStatus: { enum: ["PENDING", "ACTIVE", "SUSPENDED"] },
              zoneFees: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["zoneId", "feeMinor"],
                  properties: {
                    zoneId: { type: "string" },
                    feeMinor: { type: ["string", "null"] },
                  },
                },
              },
              contact: {
                type: "object",
                additionalProperties: false,
                required: ["phone", "email"],
                properties: {
                  phone: { type: ["string", "null"] },
                  email: { type: ["string", "null"] },
                },
              },
              fulfilment: {
                type: "object",
                additionalProperties: false,
                required: [
                  "deliveryFeeMinor",
                  "pickupEnabled",
                  "pickupInstructions",
                  "version",
                ],
                properties: {
                  deliveryFeeMinor: { type: ["string", "null"] },
                  pickupEnabled: { type: "boolean" },
                  pickupInstructions: { type: ["string", "null"] },
                  version: { type: "integer" },
                },
              },
              verification: {
                type: "object",
                additionalProperties: false,
                required: ["status", "reason"],
                properties: {
                  status: {
                    enum: [
                      "PENDING",
                      "SUBMITTED",
                      "APPROVED",
                      "REJECTED",
                      "SUSPENDED",
                    ],
                  },
                  reason: { type: ["string", "null"] },
                },
              },
            },
          },
          401: error,
          403: error,
          404: error,
        },
      },
    },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId } = request.params as { storeId: string };
      const outcome = await asRuntime(
        db,
        { userId: principal.userId },
        async (tx) => {
          const membership = await tx.storeMember.findFirst({
            where: { storeId, userId: principal.userId },
            select: {
              tenantId: true,
              storeId: true,
              userId: true,
              role: true,
              active: true,
            },
          });
          if (!membership) return { status: 404 as const };
          await enterTenant(tx, membership.tenantId);
          const store = await tx.store.findUnique({
            where: { id: storeId },
            select: {
              id: true,
              name: true,
              slug: true,
              isDemo: true,
              tenant: { select: { status: true } },
              verification: { select: { status: true, decisionReason: true } },
              deliveryFeeMinor: true,
              pickupEnabled: true,
              pickupInstructions: true,
              contactPhone: true,
              contactEmail: true,
              zoneFees: { select: { zoneId: true, feeMinor: true } },
              version: true,
            },
          });
          if (!store) return { status: 404 as const };
          const allowed = canAccess({
            userId: principal.userId,
            tenantId: membership.tenantId,
            storeId,
            permission: "store:read",
            tenantStatus: store.tenant.status,
            membership,
          });
          // Adhésion désactivée : même réponse qu'une boutique inconnue, sans trace d'existence.
          if (!allowed && !membership.active) return { status: 404 as const };
          await tx.auditLog.create({
            data: {
              tenantId: membership.tenantId,
              actorId: principal.userId,
              action: allowed ? "store.view" : "store.view.denied",
              resourceId: storeId,
              requestId: request.id,
            },
          });
          if (!allowed) return { status: 403 as const };
          const body: StoreDTO = {
            id: store.id,
            name: store.name,
            slug: store.slug,
            isDemo: store.isDemo,
            role: membership.role,
            tenantStatus: store.tenant.status,
            verification: verificationView(store.verification),
            fulfilment: {
              deliveryFeeMinor: store.deliveryFeeMinor?.toString() ?? null,
              pickupEnabled: store.pickupEnabled,
              pickupInstructions: store.pickupInstructions,
              version: store.version,
            },
            contact: { phone: store.contactPhone, email: store.contactEmail },
            zoneFees: store.zoneFees.map((z) => ({
              zoneId: z.zoneId,
              feeMinor: z.feeMinor?.toString() ?? null,
            })),
          };
          return { status: 200 as const, body };
        },
      );
      if (outcome.status === 200) return outcome.body;
      return reply.code(outcome.status).send({
        error: outcome.status === 403 ? "store_unavailable" : "not_found",
      });
    },
  );

  app.post(
    "/v1/auth/logout",
    { schema: { response: { 204: { type: "null" }, 401: error, 403: error } } },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      await asRuntime(db, {}, (tx) =>
        tx.session.updateMany({
          where: { id: principal.sessionId, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      );
      return reply.header("set-cookie", clearSessionCookie).code(204).send();
    },
  );
}
