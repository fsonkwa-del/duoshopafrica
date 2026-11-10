import { randomUUID } from "node:crypto";
import { asRuntime, type Database } from "@duoshop/database";
import { normalizeCameroonPhone } from "@duoshop/domain";
import {
  type KycKeys,
  openDocument,
  type PrivateVault,
  sealDocument,
  sniffDocumentType,
} from "@duoshop/media";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { requireStaff } from "./staff";
import { inStore } from "./store-scope";

// Lot 5 (ADR 0013) : KYC vendeur par niveaux. Les pièces arrivent par l'API (jamais en clair dans
// un stockage), leur type réel est contrôlé, puis elles sont chiffrées par enveloppe et déposées
// dans le coffre séparé. Décision par une autre personne ; chaque consultation est journalisée.
export interface KycSettings {
  vault: PrivateVault;
  keys: KycKeys;
  // Analyse antivirus facultative (lot 8) : rejette le fichier en levant une erreur « infected ».
  scan?: (data: Buffer) => Promise<"clean" | "infected">;
}
const types = [
  "ID_CARD",
  "PASSPORT",
  "SELFIE",
  "NIU_CERTIFICATE",
  "RCCM",
  "TAX_COMPLIANCE",
  "STATUTES",
  "DIRECTOR_ID",
] as const;
type DocumentType = (typeof types)[number];
const MAX_BYTES = 5 * 1024 * 1024;
const uuid = { type: "string", format: "uuid" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
  503: error,
} as const;
const anyObject = { type: "object", additionalProperties: true } as const;
const statusOf = (outcome: string) =>
  (
    ({
      forbidden: 403,
      not_found: 404,
      same_person: 403,
      reason_required: 400,
      documents_missing: 409,
      niu_required: 400,
      invalid_tier: 400,
      already_submitted: 409,
      not_submitted: 409,
    }) as Record<string, number>
  )[outcome] ?? 409;

export async function kycRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string; kyc?: KycSettings },
) {
  const { db, webOrigin, kyc } = options;

  // ---------- Vendeur : dossier, pièces, dépôt ----------
  app.get(
    "/v1/stores/:storeId/kyc",
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
        "kyc:manage",
        async (tx) => ({
          profile: await tx.kycProfile.findUnique({ where: { storeId } }),
          documents: await tx.kycDocument.findMany({
            where: { storeId, supersededAt: null, purgedAt: null },
            select: {
              id: true,
              documentType: true,
              contentType: true,
              sizeBytes: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          }),
          requirements: await tx.kycTierRequirement.findMany({
            orderBy: [{ tier: "asc" }],
          }),
        }),
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      const { profile, documents, requirements } = result.value;
      return {
        enabled: Boolean(kyc),
        status: profile?.status ?? "DRAFT",
        approvedTier: profile?.approvedTier ?? 0,
        requestedTier: profile?.requestedTier ?? null,
        reason: profile?.reason ?? null,
        documents: documents.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
        })),
        requirements,
      };
    },
  );

  // Corps brut : le type est vérifié sur les octets, la taille est bornée avant lecture.
  await app.register(async (upload) => {
    for (const type of ["image/jpeg", "image/png", "application/pdf"])
      upload.addContentTypeParser(
        type,
        { parseAs: "buffer", bodyLimit: MAX_BYTES },
        (_request, body, done) => done(null, body),
      );
    upload.post(
      "/v1/stores/:storeId/kyc/documents/:type",
      {
        config: { rateLimit: { max: 20, timeWindow: 60_000 } },
        bodyLimit: MAX_BYTES,
        schema: {
          params: {
            type: "object",
            required: ["storeId", "type"],
            properties: { storeId: uuid, type: { enum: types } },
          },
          response: { 201: anyObject, ...refusals },
        },
      },
      async (request, reply) => {
        if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
        const principal = await requirePrincipal(db, request, reply);
        if (!principal) return reply;
        if (!kyc) return reply.code(503).send({ error: "kyc_unavailable" });
        const { storeId, type } = request.params as {
          storeId: string;
          type: DocumentType;
        };
        const data = request.body;
        if (!Buffer.isBuffer(data) || data.length === 0)
          return reply.code(400).send({ error: "invalid_file" });
        const contentType = sniffDocumentType(data);
        if (!contentType)
          return reply.code(400).send({ error: "invalid_file" });
        if (kyc.scan && (await kyc.scan(data)) === "infected")
          return reply.code(400).send({ error: "infected_file" });
        const sealed = sealDocument(data, kyc.keys);
        const objectKey = `kyc/${storeId}/${randomUUID()}`;
        // Vérification des droits avant tout dépôt dans le coffre.
        const allowed = await inStore(
          db,
          principal,
          storeId,
          "kyc:manage",
          async () => true,
        );
        if (!allowed.ok)
          return reply.code(allowed.status).send({ error: allowed.error });
        await kyc.vault.put(objectKey, sealed.sealed);
        const result = await inStore(
          db,
          principal,
          storeId,
          "kyc:manage",
          async (tx, ctx) => {
            // La pièce précédente du même type est remplacée ; effacée après la durée de conservation.
            const [retention] = await tx.$queryRaw<{ at: Date }[]>`
            SELECT now() + param_interval('kyc.retention') AS at`;
            await tx.kycDocument.updateMany({
              where: { storeId, documentType: type, supersededAt: null },
              data: {
                supersededAt: new Date(),
                purgeAfter: retention?.at ?? null,
              },
            });
            const doc = await tx.kycDocument.create({
              data: {
                tenantId: ctx.tenantId,
                storeId,
                documentType: type,
                objectKey,
                wrappedKey: new Uint8Array(sealed.wrappedKey),
                keyVersion: sealed.keyVersion,
                sha256: sealed.sha256,
                contentType,
                sizeBytes: data.length,
                uploadedBy: ctx.userId,
              },
            });
            await tx.auditLog.create({
              data: {
                tenantId: ctx.tenantId,
                actorId: ctx.userId,
                action: "store.kyc.document",
                resourceId: storeId,
                requestId: request.id,
                detail: { type, contentType, sizeBytes: data.length },
              },
            });
            return doc.id;
          },
        );
        if (!result.ok) {
          await kyc.vault.delete(objectKey);
          return reply.code(result.status).send({ error: result.error });
        }
        return reply.code(201).send({ id: result.value, contentType });
      },
    );
  });

  app.post(
    "/v1/stores/:storeId/kyc/submit",
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
          required: ["tier", "mobileMoneyNumber", "location"],
          properties: {
            tier: { type: "integer", minimum: 1, maximum: 3 },
            mobileMoneyNumber: { type: "string", maxLength: 20 },
            location: { type: "string", minLength: 3, maxLength: 200 },
            niu: { type: "string", maxLength: 40 },
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
        tier: number;
        mobileMoneyNumber: string;
        location: string;
        niu?: string;
      };
      const momo = normalizeCameroonPhone(body.mobileMoneyNumber);
      if (!momo) return reply.code(400).send({ error: "invalid_phone" });
      const result = await inStore(
        db,
        principal,
        storeId,
        "kyc:manage",
        (tx) =>
          tx.$queryRaw<{ outcome: string }[]>`
          SELECT submit_kyc(${storeId}::uuid, ${body.tier}::integer, ${momo}, ${body.location},
            ${body.niu ?? null}) AS outcome`,
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      const outcome = result.value[0]?.outcome ?? "not_found";
      return outcome === "submitted"
        ? { outcome }
        : reply.code(statusOf(outcome) as 409).send({ error: outcome });
    },
  );

  // ---------- Personnel : file, décision, consultation ----------
  app.get(
    "/v1/admin/kyc",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "privacy:erase");
      if (!staff) return reply;
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => {
          const profiles = await tx.kycProfile.findMany({
            where: { status: "SUBMITTED" },
            orderBy: { submittedAt: "asc" },
            take: 100,
            include: { store: { select: { name: true } } },
          });
          const documents = await tx.kycDocument.findMany({
            where: {
              storeId: { in: profiles.map((p) => p.storeId) },
              supersededAt: null,
              purgedAt: null,
            },
            select: {
              id: true,
              storeId: true,
              documentType: true,
              contentType: true,
              createdAt: true,
            },
          });
          return { profiles, documents };
        },
      );
      return {
        queue: rows.profiles.map((p) => ({
          storeId: p.storeId,
          storeName: p.store.name,
          requestedTier: p.requestedTier,
          approvedTier: p.approvedTier,
          // Numéro masqué : affichage complet avec les pièces, sur motif journalisé.
          mobileMoneyNumber: p.mobileMoneyNumber
            ? `••••••${p.mobileMoneyNumber.slice(-2)}`
            : null,
          location: p.location,
          niu: p.niu,
          submittedAt: p.submittedAt?.toISOString() ?? null,
          submittedByMe: p.submittedBy === staff.principal.userId,
          documents: rows.documents
            .filter((d) => d.storeId === p.storeId)
            .map((d) => ({ ...d, createdAt: d.createdAt.toISOString() })),
        })),
      };
    },
  );

  app.post(
    "/v1/admin/kyc/:storeId/review",
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
          required: ["approve"],
          properties: {
            approve: { type: "boolean" },
            reason: { type: "string", maxLength: 1000 },
          },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "privacy:erase");
      if (!staff) return reply;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as { approve: boolean; reason?: string };
      const [row] = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.$queryRaw<{ outcome: string }[]>`
          SELECT review_kyc(${storeId}::uuid, ${body.approve}, ${body.reason ?? null}) AS outcome`,
      );
      const outcome = row?.outcome ?? "not_found";
      return outcome === "approved" || outcome === "rejected"
        ? { outcome }
        : reply.code(statusOf(outcome) as 409).send({ error: outcome });
    },
  );

  // Consultation d'une pièce : formulaire POST (motif), fichier déchiffré renvoyé sans cache.
  await app.register(async (view) => {
    view.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 4096 },
      (_request, body, done) =>
        done(null, Object.fromEntries(new URLSearchParams(String(body)))),
    );
    view.post(
      "/v1/admin/kyc/documents/:documentId/view",
      {
        config: { rateLimit: { max: 30, timeWindow: 60_000 } },
        schema: {
          params: {
            type: "object",
            required: ["documentId"],
            properties: { documentId: uuid },
          },
          body: {
            type: "object",
            required: ["reason"],
            properties: { reason: { type: "string", maxLength: 500 } },
          },
        },
      },
      async (request, reply: FastifyReply) => {
        if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
        const staff = await requireStaff(db, request, reply, "privacy:erase");
        if (!staff) return reply;
        if (!kyc) return reply.code(503).send({ error: "kyc_unavailable" });
        const { documentId } = request.params as { documentId: string };
        const { reason } = request.body as { reason: string };
        const [row] = await asRuntime(
          db,
          { userId: staff.principal.userId },
          (tx) =>
            tx.$queryRaw<
              {
                objectKey: string | null;
                wrappedKey: Uint8Array | null;
                keyVersion: number | null;
                contentType: string | null;
                sha256: string | null;
                outcome: string;
              }[]
            >`SELECT * FROM reveal_kyc_document(${documentId}::uuid, ${reason})`,
        );
        if (
          row?.outcome !== "ok" ||
          !row.objectKey ||
          !row.wrappedKey ||
          !row.keyVersion
        )
          return reply
            .code(statusOf(row?.outcome ?? "not_found") as 404)
            .send({ error: row?.outcome ?? "not_found" });
        const sealed = await kyc.vault.get(row.objectKey);
        if (!sealed) return reply.code(404).send({ error: "not_found" });
        const data = openDocument(
          sealed,
          Buffer.from(row.wrappedKey),
          row.keyVersion,
          kyc.keys,
        );
        return reply
          .type(row.contentType ?? "application/octet-stream")
          .header("cache-control", "private, no-store")
          .header("content-disposition", "inline")
          .header("x-content-type-options", "nosniff")
          .send(data);
      },
    );
  });
}
