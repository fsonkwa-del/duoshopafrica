import { randomUUID } from "node:crypto";
import type { Database } from "@duoshop/database";
import {
  MAX_UPLOAD_BYTES,
  type ObjectStorage,
  type PresignedUpload,
} from "@duoshop/media";
import type { FastifyInstance } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { inStore } from "./store-scope";

export const MAX_MEDIA_PER_PRODUCT = 8;
const mediaParams = {
  type: "object",
  required: ["storeId", "productId", "mediaId"],
  properties: {
    storeId: { type: "string", format: "uuid" },
    productId: { type: "string", format: "uuid" },
    mediaId: { type: "string", format: "uuid" },
  },
} as const;
const UPLOAD_TTL_SECONDS = 300;
const uuid = { type: "string", format: "uuid" } as const;
// Texte alternatif obligatoire dans les deux langues (accessibilité, lecteurs d'écran).
const alt = { type: "string", minLength: 3, maxLength: 200 } as const;

export async function mediaRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string; storage?: ObjectStorage },
) {
  const { db, webOrigin, storage } = options;

  app.post(
    "/v1/stores/:storeId/products/:productId/media",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId", "productId"],
          properties: { storeId: uuid, productId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["contentType", "bytes", "altFr", "altEn"],
          properties: {
            // Type déclaré pour la signature S3 ; le vrai type est revérifié par le worker.
            contentType: { enum: ["image/jpeg", "image/png", "image/webp"] },
            bytes: { type: "integer", minimum: 1, maximum: MAX_UPLOAD_BYTES },
            altFr: alt,
            altEn: alt,
          },
        },
        response: {
          201: {
            type: "object",
            required: ["mediaId", "upload"],
            properties: {
              mediaId: { type: "string" },
              upload: {
                type: "object",
                required: ["url", "method", "headers", "expiresAt"],
                properties: {
                  url: { type: "string" },
                  method: { const: "PUT" },
                  headers: {
                    type: "object",
                    additionalProperties: { type: "string" },
                  },
                  expiresAt: { type: "string" },
                },
              },
            },
          },
          400: error,
          401: error,
          403: error,
          404: error,
          409: error,
          503: error,
        },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      if (!storage)
        return reply.code(503).send({ error: "media_storage_not_configured" });
      const { storeId, productId } = request.params as {
        storeId: string;
        productId: string;
      };
      const body = request.body as {
        contentType: string;
        bytes: number;
        altFr: string;
        altEn: string;
      };
      const result = await inStore(
        db,
        principal,
        storeId,
        "catalog:write",
        async (
          tx,
          ctx,
        ): Promise<
          | { code: 404 | 409; error: string }
          | { code: 201; id: string; uploadKey: string }
        > => {
          const product = await tx.product.findFirst({
            where: { id: productId, storeId },
            select: { id: true },
          });
          if (!product) return { code: 404 as const, error: "not_found" };
          const count = await tx.productMedia.count({
            where: { productId, status: { not: "REJECTED" } },
          });
          if (count >= MAX_MEDIA_PER_PRODUCT)
            return { code: 409 as const, error: "media_limit" };
          const id = randomUUID();
          // Clé de quarantaine générée par le serveur : jamais de nom de fichier fourni par le client.
          const uploadKey = `quarantine/${ctx.tenantId}/${id}`;
          await tx.productMedia.create({
            data: {
              id,
              tenantId: ctx.tenantId,
              productId,
              position: count,
              uploadKey,
              altFr: body.altFr.trim(),
              altEn: body.altEn.trim(),
            },
          });
          return { code: 201 as const, id, uploadKey };
        },
      );
      if (!result.ok)
        return reply.code(result.status).send({ error: result.error });
      const outcome = result.value;
      if (!("id" in outcome))
        return reply.code(outcome.code).send({ error: outcome.error });
      const upload: PresignedUpload = await storage.presignUpload(
        outcome.uploadKey,
        body.contentType,
        body.bytes,
        UPLOAD_TTL_SECONDS,
      );
      return reply.code(201).send({ mediaId: outcome.id, upload });
    },
  );

  // Retrait d'une photo, ou choix de la photo principale (position 0) : les positions restantes
  // sont renumérotées sans trou, sous verrou du produit (deux changements ne se croisent pas).
  for (const action of ["remove", "primary"] as const)
    app.post(
      `/v1/stores/:storeId/products/:productId/media/:mediaId/${action}`,
      {
        schema: {
          params: mediaParams,
          response: {
            200: {
              type: "object",
              required: ["ok"],
              properties: { ok: { const: true } },
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
        const { storeId, productId, mediaId } = request.params as {
          storeId: string;
          productId: string;
          mediaId: string;
        };
        const result = await inStore(
          db,
          principal,
          storeId,
          "catalog:write",
          async (
            tx,
            ctx,
          ): Promise<{ code: 200 | 404 | 409; error?: string }> => {
            const locked = await tx.$queryRaw<{ id: string }[]>`
              SELECT id FROM "Product"
               WHERE id = ${productId}::uuid AND "storeId" = ${storeId}::uuid
                 FOR UPDATE`;
            if (!locked.length) return { code: 404, error: "not_found" };
            const media = await tx.productMedia.findMany({
              where: { productId },
              orderBy: [{ position: "asc" }, { createdAt: "asc" }],
              select: { id: true, status: true },
            });
            const target = media.find((m) => m.id === mediaId);
            if (!target) return { code: 404, error: "not_found" };
            if (action === "remove" && target.status === "PENDING")
              return { code: 409, error: "media_processing" };
            if (action === "primary" && target.status !== "READY")
              return { code: 409, error: "media_not_ready" };
            const rest = media.filter((m) => m.id !== mediaId);
            const order = action === "primary" ? [target, ...rest] : rest;
            if (action === "remove")
              await tx.productMedia.delete({ where: { id: mediaId } });
            for (const [position, m] of order.entries())
              await tx.productMedia.update({
                where: { id: m.id },
                data: { position },
              });
            await tx.auditLog.create({
              data: {
                tenantId: ctx.tenantId,
                actorId: ctx.userId,
                action: `catalog.media.${action}`,
                resourceId: productId,
                requestId: request.id,
                detail: { mediaId },
              },
            });
            return { code: 200 };
          },
        );
        if (!result.ok)
          return reply.code(result.status).send({ error: result.error });
        const outcome = result.value;
        if (outcome.code !== 200)
          return reply.code(outcome.code).send({ error: outcome.error });
        return { ok: true };
      },
    );
}
