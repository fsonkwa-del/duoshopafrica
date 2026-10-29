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
}
