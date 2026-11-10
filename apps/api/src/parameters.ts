import {
  asRuntime,
  type Database,
  decideParameter,
  parameterRefusal,
  proposeParameter,
} from "@duoshop/database";
import type {
  ParameterDefinitionDTO,
  ParameterKindDTO,
  ParametersDTO,
  ParameterValueDTO,
} from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import { errorSchema as error, requireSameOrigin } from "./guards";
import { requireStaff } from "./staff";

// Paramètres réglementaires datés (ADR 0008). Lecture : ADMIN et FINANCE. Proposition : le rôle
// propriétaire de la clé ; approbation : une autre personne. Les fonctions SQL font foi.
const uuid = { type: "string", format: "uuid" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
} as const;
const anyObject = { type: "object", additionalProperties: true } as const;

type ValueRow = {
  id: string;
  key: string;
  storeId: string | null;
  value: unknown;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  legalBasis: string | null;
  validationStatus: "A_VALIDER" | "VALIDE";
  proposedBy: string | null;
  proposedAt: Date;
  approvedAt: Date | null;
  rejectedAt: Date | null;
  rejectReason: string | null;
};
const valueView = (r: ValueRow, me: string): ParameterValueDTO => ({
  id: r.id,
  key: r.key,
  storeId: r.storeId,
  value: typeof r.value === "string" ? r.value : JSON.stringify(r.value),
  effectiveFrom: r.effectiveFrom.toISOString(),
  effectiveTo: r.effectiveTo?.toISOString() ?? null,
  legalBasis: r.legalBasis,
  validationStatus: r.validationStatus,
  proposedAt: r.proposedAt.toISOString(),
  approvedAt: r.approvedAt?.toISOString() ?? null,
  rejectedAt: r.rejectedAt?.toISOString() ?? null,
  rejectReason: r.rejectReason,
  proposedByMe: r.proposedBy === me,
});

const decisionStatus = {
  approved: 200,
  rejected: 200,
  not_found: 404,
  already_decided: 409,
  same_person: 403,
  reason_required: 400,
  retroactive: 409,
  conflict: 409,
} as const;

export async function parameterRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  app.get(
    "/v1/admin/parameters",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "parameter:read");
      if (!staff) return reply;
      const me = staff.principal.userId;
      const { definitions, values } = await asRuntime(
        db,
        { userId: me },
        async (tx) => ({
          definitions: await tx.parameterDefinition.findMany({
            orderBy: { key: "asc" },
          }),
          values: await tx.regulatoryParameter.findMany({
            orderBy: [{ key: "asc" }, { effectiveFrom: "desc" }],
            take: 500,
          }),
        }),
      );
      const now = Date.now();
      const approved = values.filter((v) => v.approvedAt);
      const body: ParametersDTO = {
        definitions: definitions.map((d): ParameterDefinitionDTO => {
          const current = approved.find(
            (v) =>
              v.key === d.key &&
              v.storeId === null &&
              v.effectiveFrom.getTime() <= now &&
              (!v.effectiveTo || v.effectiveTo.getTime() > now),
          );
          return {
            key: d.key,
            kind: d.kind as ParameterKindDTO,
            ownerRole: d.ownerRole,
            storeScoped: d.storeScoped,
            minValue: d.minValue,
            maxValue: d.maxValue,
            labelFr: d.labelFr,
            labelEn: d.labelEn,
            current: current ? valueView(current, me) : null,
            canPropose: d.ownerRole === staff.role,
          };
        }),
        pending: values
          .filter((v) => !v.approvedAt && !v.rejectedAt)
          .map((v) => valueView(v, me)),
        history: values
          .filter((v) => v.approvedAt || v.rejectedAt)
          .map((v) => valueView(v, me)),
      };
      return body;
    },
  );

  app.post(
    "/v1/admin/parameters",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["key", "value", "effectiveFrom", "validated"],
          properties: {
            key: { type: "string", minLength: 3, maxLength: 80 },
            storeId: uuid,
            value: { type: "string", minLength: 1, maxLength: 2000 },
            effectiveFrom: { type: "string", format: "date-time" },
            legalBasis: { type: "string", maxLength: 500 },
            validated: { type: "boolean" },
          },
        },
        response: { 201: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "parameter:propose");
      if (!staff) return reply;
      const body = request.body as {
        key: string;
        storeId?: string;
        value: string;
        effectiveFrom: string;
        legalBasis?: string;
        validated: boolean;
      };
      try {
        const id = await asRuntime(
          db,
          { userId: staff.principal.userId },
          (tx) =>
            proposeParameter(tx, {
              key: body.key,
              storeId: body.storeId ?? null,
              value: body.value.trim(),
              effectiveFrom: new Date(body.effectiveFrom),
              legalBasis: body.legalBasis?.trim() || null,
              validated: body.validated,
            }),
        );
        return reply.code(201).send({ id });
      } catch (err) {
        const code = parameterRefusal(err);
        if (!code) throw err;
        const status =
          code === "parameter_forbidden"
            ? 403
            : code === "parameter_unknown" || code === "parameter_store_unknown"
              ? 404
              : 400;
        return reply.code(status).send({ error: code });
      }
    },
  );

  app.post(
    "/v1/admin/parameters/:parameterId/decide",
    {
      schema: {
        params: {
          type: "object",
          required: ["parameterId"],
          properties: { parameterId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["approve"],
          properties: {
            approve: { type: "boolean" },
            reason: { type: "string", maxLength: 500 },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "parameter:decide");
      if (!staff) return reply;
      const { parameterId } = request.params as { parameterId: string };
      const body = request.body as { approve: boolean; reason?: string };
      const outcome = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          decideParameter(
            tx,
            parameterId,
            body.approve,
            body.reason?.trim() || null,
          ),
      );
      const status = decisionStatus[outcome];
      return status === 200
        ? { outcome }
        : reply.code(status).send({ error: outcome });
    },
  );
}
