import { businessDefaults } from "@duoshop/config";
import { adjustStock, type Database, type ScopedTx } from "@duoshop/database";
import {
  canChangeProductStatus,
  normalizeSku,
  type ProductStatus,
  parsePriceMinor,
  permissionForProductStatus,
} from "@duoshop/domain";
import type { ProductDTO, VariantDTO } from "@duoshop/types";
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  errorSchema as error,
  requirePrincipal,
  requireSameOrigin,
} from "./guards";
import { inStore, type Scoped, type StoreContext } from "./store-scope";

const DEFAULT_LOCATION = "Principal";
const uuid = { type: "string", format: "uuid" } as const;
const storeParams = {
  type: "object",
  required: ["storeId"],
  properties: { storeId: uuid },
} as const;
const priceMinor = { type: "string", pattern: "^[0-9]{1,15}$" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
} as const;

type Outcome =
  | { code: 200 | 201; body: unknown }
  | { code: 400 | 404 | 409; error: string };

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    err.code === "P2002"
  );
}
async function send(reply: FastifyReply, result: Scoped<Outcome>) {
  if (!result.ok)
    return reply.code(result.status).send({ error: result.error });
  const outcome = result.value;
  return "body" in outcome
    ? reply.code(outcome.code).send(outcome.body)
    : reply.code(outcome.code).send({ error: outcome.error });
}

async function defaultLocation(tx: ScopedTx, ctx: StoreContext) {
  const where = {
    storeId_name: { storeId: ctx.storeId, name: DEFAULT_LOCATION },
  };
  return (
    (await tx.inventoryLocation.findUnique({ where })) ??
    tx.inventoryLocation.create({
      data: {
        tenantId: ctx.tenantId,
        storeId: ctx.storeId,
        name: DEFAULT_LOCATION,
      },
    })
  );
}

const productInclude = {
  media: {
    orderBy: { position: "asc" },
    select: { id: true, status: true, rejectReason: true, altFr: true },
  },
  variants: {
    orderBy: { createdAt: "asc" },
    include: { stock: { select: { onHand: true, reserved: true } } },
  },
} as const;
type ProductRow = Awaited<
  ReturnType<ScopedTx["product"]["findMany"]>
>[number] & {
  media: {
    id: string;
    status: "PENDING" | "READY" | "REJECTED";
    rejectReason: string | null;
    altFr: string;
  }[];
  variants: (Awaited<
    ReturnType<ScopedTx["productVariant"]["findMany"]>
  >[number] & {
    stock: { onHand: number; reserved: number }[];
  })[];
};
function toVariant(v: ProductRow["variants"][number]): VariantDTO {
  const onHand = v.stock.reduce((sum, s) => sum + s.onHand, 0);
  const reserved = v.stock.reduce((sum, s) => sum + s.reserved, 0);
  return {
    id: v.id,
    sku: v.sku,
    label: v.label,
    price: { amountMinor: v.priceMinor.toString(), currency: v.currency },
    active: v.active,
    version: v.version,
    stock: { onHand, reserved, available: onHand - reserved },
  };
}
function toProduct(p: ProductRow): ProductDTO {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    status: p.status,
    version: p.version,
    variants: p.variants.map(toVariant),
    media: p.media,
  };
}
// La variante doit appartenir à un produit de CETTE boutique (pas seulement du tenant).
function variantOfStore(tx: ScopedTx, ctx: StoreContext, variantId: string) {
  return tx.productVariant.findFirst({
    where: { id: variantId, product: { storeId: ctx.storeId } },
  });
}

export async function catalogRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  app.get(
    "/v1/stores/:storeId/products",
    { schema: { params: storeParams, response: refusals } },
    async (request, reply) => {
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId } = request.params as { storeId: string };
      const result = await inStore(
        db,
        principal,
        storeId,
        "store:read",
        async (tx) => {
          const rows = (await tx.product.findMany({
            where: { storeId },
            orderBy: { createdAt: "desc" },
            take: 200,
            include: productInclude,
          })) as ProductRow[];
          return {
            code: 200 as const,
            body: { products: rows.map(toProduct) },
          };
        },
      );
      return send(reply, result);
    },
  );

  app.post(
    "/v1/stores/:storeId/products",
    {
      schema: {
        params: storeParams,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["title", "variants"],
          properties: {
            title: { type: "string", minLength: 2, maxLength: 140 },
            description: { type: "string", maxLength: 2000 },
            variants: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["sku", "label", "priceMinor"],
                properties: {
                  sku: { type: "string", minLength: 1, maxLength: 64 },
                  label: { type: "string", minLength: 1, maxLength: 80 },
                  priceMinor,
                },
              },
            },
          },
        },
        response: refusals,
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId } = request.params as { storeId: string };
      const body = request.body as {
        title: string;
        description?: string;
        variants: { sku: string; label: string; priceMinor: string }[];
      };
      const variants = body.variants.map((v) => ({
        sku: normalizeSku(v.sku),
        label: v.label.trim(),
        price: parsePriceMinor(v.priceMinor),
      }));
      const skus = new Set(variants.map((v) => v.sku));
      if (
        variants.some((v) => !v.sku || !v.price || !v.label) ||
        skus.size !== variants.length ||
        body.title.trim().length < 2
      )
        return reply.code(400).send({ error: "invalid_request" });
      try {
        const result = await inStore(
          db,
          principal,
          storeId,
          "catalog:write",
          async (tx, ctx) => {
            const location = await defaultLocation(tx, ctx);
            const product = await tx.product.create({
              data: {
                tenantId: ctx.tenantId,
                storeId,
                title: body.title.trim(),
                description: body.description?.trim() || null,
              },
            });
            for (const v of variants) {
              const variant = await tx.productVariant.create({
                data: {
                  tenantId: ctx.tenantId,
                  productId: product.id,
                  sku: v.sku as string,
                  label: v.label,
                  priceMinor: v.price as bigint,
                  currency: businessDefaults.currency,
                },
              });
              await tx.stockLevel.create({
                data: {
                  tenantId: ctx.tenantId,
                  variantId: variant.id,
                  locationId: location.id,
                },
              });
            }
            await tx.auditLog.create({
              data: {
                tenantId: ctx.tenantId,
                actorId: ctx.userId,
                action: "catalog.product.create",
                resourceId: product.id,
                requestId: request.id,
                detail: { storeId, skus: [...skus] },
              },
            });
            const created = (await tx.product.findUniqueOrThrow({
              where: { id: product.id },
              include: productInclude,
            })) as ProductRow;
            return { code: 201 as const, body: toProduct(created) };
          },
        );
        return send(reply, result);
      } catch (err) {
        if (isUniqueViolation(err))
          return reply.code(409).send({ error: "sku_taken" });
        throw err;
      }
    },
  );

  app.post(
    "/v1/stores/:storeId/products/:productId/status",
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
          required: ["status", "expectedVersion"],
          properties: {
            status: { enum: ["DRAFT", "PUBLISHED", "ARCHIVED"] },
            expectedVersion: { type: "integer", minimum: 0 },
          },
        },
        response: refusals,
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId, productId } = request.params as {
        storeId: string;
        productId: string;
      };
      const { status, expectedVersion } = request.body as {
        status: ProductStatus;
        expectedVersion: number;
      };
      const result = await inStore(
        db,
        principal,
        storeId,
        permissionForProductStatus(status),
        async (tx, ctx): Promise<Outcome> => {
          const product = await tx.product.findFirst({
            where: { id: productId, storeId },
            include: {
              variants: { where: { active: true }, select: { id: true } },
            },
          });
          if (!product) return { code: 404, error: "not_found" };
          if (product.version !== expectedVersion)
            return { code: 409, error: "stale_version" };
          if (!canChangeProductStatus(product.status, status))
            return { code: 409, error: "invalid_transition" };
          if (status === "PUBLISHED" && product.variants.length === 0)
            return { code: 409, error: "no_active_variant" };
          const { count } = await tx.product.updateMany({
            where: { id: productId, version: expectedVersion },
            data: {
              status,
              version: { increment: 1 },
              ...(status === "PUBLISHED" ? { publishedAt: new Date() } : {}),
            },
          });
          if (count !== 1) return { code: 409, error: "stale_version" };
          await tx.auditLog.create({
            data: {
              tenantId: ctx.tenantId,
              actorId: ctx.userId,
              action: `catalog.product.${status.toLowerCase()}`,
              resourceId: productId,
              requestId: request.id,
              detail: { from: product.status, to: status },
            },
          });
          return { code: 200, body: { status, version: expectedVersion + 1 } };
        },
      );
      return send(reply, result);
    },
  );

  app.post(
    "/v1/stores/:storeId/variants/:variantId/price",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId", "variantId"],
          properties: { storeId: uuid, variantId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["priceMinor", "expectedVersion"],
          properties: {
            priceMinor,
            expectedVersion: { type: "integer", minimum: 0 },
          },
        },
        response: refusals,
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId, variantId } = request.params as {
        storeId: string;
        variantId: string;
      };
      const body = request.body as {
        priceMinor: string;
        expectedVersion: number;
      };
      const price = parsePriceMinor(body.priceMinor);
      if (!price) return reply.code(400).send({ error: "invalid_request" });
      const result = await inStore(
        db,
        principal,
        storeId,
        "catalog:write",
        async (tx, ctx): Promise<Outcome> => {
          const variant = await variantOfStore(tx, ctx, variantId);
          if (!variant) return { code: 404, error: "not_found" };
          const { count } = await tx.productVariant.updateMany({
            where: { id: variantId, version: body.expectedVersion },
            data: { priceMinor: price, version: { increment: 1 } },
          });
          if (count !== 1) return { code: 409, error: "stale_version" };
          // Historique des prix : l'audit fige l'ancien et le nouveau montant.
          await tx.auditLog.create({
            data: {
              tenantId: ctx.tenantId,
              actorId: ctx.userId,
              action: "catalog.price.change",
              resourceId: variantId,
              requestId: request.id,
              detail: {
                sku: variant.sku,
                currency: variant.currency,
                from: variant.priceMinor.toString(),
                to: price.toString(),
              },
            },
          });
          return {
            code: 200,
            body: {
              price: {
                amountMinor: price.toString(),
                currency: variant.currency,
              },
              version: body.expectedVersion + 1,
            },
          };
        },
      );
      return send(reply, result);
    },
  );

  app.post(
    "/v1/stores/:storeId/variants/:variantId/stock",
    {
      schema: {
        params: {
          type: "object",
          required: ["storeId", "variantId"],
          properties: { storeId: uuid, variantId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["delta", "reason", "idempotencyKey"],
          properties: {
            delta: {
              type: "integer",
              minimum: -100000,
              maximum: 100000,
              not: { const: 0 },
            },
            reason: { enum: ["RECEIPT", "ADJUSTMENT"] },
            note: { type: "string", maxLength: 200 },
            idempotencyKey: {
              type: "string",
              pattern: "^[A-Za-z0-9_-]{8,64}$",
            },
          },
        },
        response: refusals,
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const principal = await requirePrincipal(db, request, reply);
      if (!principal) return reply;
      const { storeId, variantId } = request.params as {
        storeId: string;
        variantId: string;
      };
      const body = request.body as {
        delta: number;
        reason: "RECEIPT" | "ADJUSTMENT";
        note?: string;
        idempotencyKey: string;
      };
      if (body.reason === "RECEIPT" && body.delta < 0)
        return reply.code(400).send({ error: "invalid_request" });
      const attempt = () =>
        inStore(
          db,
          principal,
          storeId,
          "inventory:write",
          async (tx, ctx): Promise<Outcome> => {
            const variant = await variantOfStore(tx, ctx, variantId);
            if (!variant) return { code: 404, error: "not_found" };
            const location = await defaultLocation(tx, ctx);
            const outcome = await adjustStock(tx, {
              tenantId: ctx.tenantId,
              variantId,
              locationId: location.id,
              delta: body.delta,
              reason: body.reason,
              note: body.note?.trim() || null,
              actorId: ctx.userId,
              idempotencyKey: body.idempotencyKey,
            });
            if (outcome.status === "applied" || outcome.status === "replayed")
              return {
                code: 200,
                body: {
                  replayed: outcome.status === "replayed",
                  stock: {
                    onHand: outcome.onHand,
                    reserved: outcome.reserved,
                    available: outcome.onHand - outcome.reserved,
                  },
                },
              };
            if (outcome.status === "not_found")
              return { code: 404, error: "not_found" };
            return {
              code: 409,
              error:
                outcome.status === "conflict"
                  ? "idempotency_conflict"
                  : "insufficient_stock",
            };
          },
        );
      try {
        return send(reply, await attempt());
      } catch (err) {
        // Même clé envoyée deux fois au même instant : le perdant est rejoué, jamais appliqué.
        if (!isUniqueViolation(err)) throw err;
        return send(reply, await attempt());
      }
    },
  );
}
