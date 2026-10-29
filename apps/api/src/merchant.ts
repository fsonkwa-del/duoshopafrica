import { asRuntime, type Database, enterTenant } from "@duoshop/database";
import {
  applyDecision,
  canAccess,
  canSubmitVerification,
  DECISION_REASON_MIN_LENGTH,
  type MerchantDecision,
} from "@duoshop/domain";
import type {
  AuditEntryDTO,
  VerificationQueueItemDTO,
  VerificationStatusDTO,
} from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { requireStaff } from "./staff";

const storeParams = {
  type: "object",
  required: ["storeId"],
  properties: { storeId: { type: "string", format: "uuid" } },
} as const;
const statuses = ["PENDING", "SUBMITTED", "APPROVED", "REJECTED", "SUSPENDED"];

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "P2002"
  );
}

export async function merchantRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  app.post(
    "/v1/stores/:storeId/verification",
    {
      schema: {
        params: storeParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["legalName"],
          properties: {
            legalName: { type: "string", minLength: 2, maxLength: 160 },
            registrationNumber: {
              type: "string",
              maxLength: 64,
              pattern: "^[A-Za-z0-9 ./-]*$",
            },
          },
        },
        response: {
          200: {
            type: "object",
            required: ["status"],
            properties: { status: { const: "SUBMITTED" } },
          },
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
      const { storeId } = request.params as { storeId: string };
      const body = request.body as {
        legalName: string;
        registrationNumber?: string;
      };
      const legalName = body.legalName.trim();
      const registrationNumber = body.registrationNumber?.trim() || null;
      let outcome: { status: 200 | 403 | 404 | 409; error?: string };
      try {
        outcome = await asRuntime(
          db,
          { userId: principal.userId },
          async (tx) => {
            const membership = await tx.storeMember.findFirst({
              where: { storeId, userId: principal.userId, active: true },
              select: {
                tenantId: true,
                storeId: true,
                userId: true,
                role: true,
                active: true,
              },
            });
            if (!membership)
              return { status: 404 as const, error: "not_found" };
            await enterTenant(tx, membership.tenantId);
            const store = await tx.store.findUnique({
              where: { id: storeId },
              select: {
                tenant: { select: { status: true } },
                verification: true,
              },
            });
            if (!store) return { status: 404 as const, error: "not_found" };
            const allowed = canAccess({
              userId: principal.userId,
              tenantId: membership.tenantId,
              storeId,
              permission: "store:verify",
              tenantStatus: store.tenant.status,
              membership,
            });
            if (!allowed) return { status: 403 as const, error: "forbidden" };
            const current = store.verification;
            const from = current?.status ?? "PENDING";
            if (!canSubmitVerification(from))
              return { status: 409 as const, error: "invalid_state" };
            const submitted = {
              status: "SUBMITTED" as const,
              legalName,
              registrationNumber,
              submittedAt: new Date(),
              decisionReason: null,
              reviewedBy: null,
              reviewedAt: null,
            };
            if (!current)
              await tx.merchantVerification.create({
                data: { tenantId: membership.tenantId, storeId, ...submitted },
              });
            else {
              const { count } = await tx.merchantVerification.updateMany({
                where: {
                  id: current.id,
                  version: current.version,
                  status: current.status,
                },
                data: { ...submitted, version: { increment: 1 } },
              });
              if (count !== 1)
                return { status: 409 as const, error: "conflict" };
            }
            await tx.auditLog.create({
              data: {
                tenantId: membership.tenantId,
                actorId: principal.userId,
                action: "merchant.submit",
                resourceId: storeId,
                requestId: request.id,
                detail: { from, to: "SUBMITTED" },
              },
            });
            return { status: 200 as const };
          },
        );
      } catch (err) {
        // Deux soumissions initiales simultanées : la contrainte d'unicité tranche.
        if (!isUniqueViolation(err)) throw err;
        outcome = { status: 409, error: "conflict" };
      }
      if (outcome.status === 200) return { status: "SUBMITTED" };
      return reply.code(outcome.status).send({ error: outcome.error });
    },
  );

  app.get(
    "/v1/admin/verifications",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { status: { enum: statuses, default: "SUBMITTED" } },
        },
        response: { 401: error, 403: error, 404: error },
      },
    },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "merchant:review");
      if (!staff) return reply;
      const { status } = request.query as { status: VerificationStatusDTO };
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.merchantVerification.findMany({
            where: { status },
            orderBy: [{ submittedAt: "asc" }, { id: "asc" }],
            take: 100,
            select: {
              storeId: true,
              status: true,
              legalName: true,
              registrationNumber: true,
              submittedAt: true,
              version: true,
              store: { select: { name: true, slug: true } },
            },
          }),
      );
      const items: VerificationQueueItemDTO[] = rows.map((row) => ({
        storeId: row.storeId,
        storeName: row.store.name,
        storeSlug: row.store.slug,
        status: row.status,
        legalName: row.legalName,
        registrationNumber: row.registrationNumber,
        submittedAt: row.submittedAt?.toISOString() ?? null,
        version: row.version,
      }));
      return { items };
    },
  );

  app.post(
    "/v1/admin/verifications/:storeId/decision",
    {
      schema: {
        params: storeParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["decision", "reason", "expectedVersion"],
          properties: {
            decision: { enum: ["APPROVE", "REJECT", "SUSPEND", "REINSTATE"] },
            reason: {
              type: "string",
              minLength: DECISION_REASON_MIN_LENGTH,
              maxLength: 1000,
            },
            expectedVersion: { type: "integer", minimum: 0 },
          },
        },
        response: {
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
      const staff = await requireStaff(db, request, reply, "merchant:decide");
      if (!staff) return reply;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as {
        decision: MerchantDecision;
        reason: string;
        expectedVersion: number;
      };
      const reason = body.reason.trim();
      if (reason.length < DECISION_REASON_MIN_LENGTH)
        return reply.code(400).send({ error: "reason_required" });
      const actorId = staff.principal.userId;
      // Décision, état du tenant et audit dans la même transaction : tout ou rien.
      const outcome = await asRuntime(db, { userId: actorId }, async (tx) => {
        const verification = await tx.merchantVerification.findUnique({
          where: { storeId },
        });
        if (!verification) return { status: 404 as const, error: "not_found" };
        // Séparation des tâches : jamais de décision sur une boutique dont on est membre.
        const ownMembership = await tx.storeMember.count({
          where: { storeId, userId: actorId },
        });
        if (ownMembership > 0)
          return { status: 403 as const, error: "conflict_of_interest" };
        if (verification.version !== body.expectedVersion)
          return { status: 409 as const, error: "stale_version" };
        const next = applyDecision(verification.status, body.decision);
        if (!next) return { status: 409 as const, error: "invalid_transition" };
        await enterTenant(tx, verification.tenantId);
        const { count } = await tx.merchantVerification.updateMany({
          where: {
            id: verification.id,
            version: body.expectedVersion,
            status: verification.status,
          },
          data: {
            status: next.status,
            decisionReason: reason,
            reviewedBy: actorId,
            reviewedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (count !== 1)
          return { status: 409 as const, error: "stale_version" };
        await tx.tenant.update({
          where: { id: verification.tenantId },
          data: { status: next.tenantStatus, version: { increment: 1 } },
        });
        await tx.auditLog.create({
          data: {
            tenantId: verification.tenantId,
            actorId,
            action: `merchant.${body.decision.toLowerCase()}`,
            resourceId: storeId,
            requestId: request.id,
            detail: {
              from: verification.status,
              to: next.status,
              tenantStatus: next.tenantStatus,
              reason,
              actorRole: staff.role,
            },
          },
        });
        return {
          status: 200 as const,
          body: {
            status: next.status,
            tenantStatus: next.tenantStatus,
            version: body.expectedVersion + 1,
          },
        };
      });
      if (outcome.status === 200) return outcome.body;
      return reply.code(outcome.status).send({ error: outcome.error });
    },
  );

  app.get(
    "/v1/admin/stores/:storeId/audit",
    {
      schema: {
        params: storeParams,
        response: { 401: error, 403: error, 404: error },
      },
    },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "merchant:review");
      if (!staff) return reply;
      const { storeId } = request.params as { storeId: string };
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.auditLog.findMany({
            where: { resourceId: storeId, action: { startsWith: "merchant." } },
            orderBy: { createdAt: "desc" },
            take: 100,
            select: {
              action: true,
              actorId: true,
              requestId: true,
              createdAt: true,
              detail: true,
            },
          }),
      );
      const entries: AuditEntryDTO[] = rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      }));
      return { entries };
    },
  );
}
