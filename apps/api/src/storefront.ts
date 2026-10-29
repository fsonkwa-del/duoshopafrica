import { asRuntime, type Database } from "@duoshop/database";
import { availabilityOf, toSearchQuery } from "@duoshop/domain";
import type {
  CatalogItemDTO,
  CatalogPageDTO,
  MediaDTO,
  PublicProductDTO,
} from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import { errorSchema as error } from "./guards";

export const PAGE_SIZE = 24;
const publicLimit = { config: { rateLimit: { max: 120, timeWindow: 60_000 } } };

export function mediaUrl(
  base: string | undefined,
  key: string | null,
): string | null {
  return base && key ? `${base.replace(/\/$/, "")}/${encodeURI(key)}` : null;
}

interface SearchRow {
  id: string;
  title: string;
  storeName: string;
  storeSlug: string;
  priceFrom: bigint;
  currency: string;
  available: number;
  imageKey: string | null;
  altFr: string | null;
  altEn: string | null;
  width: number | null;
  height: number | null;
}

// Lecture publique SANS contexte utilisateur ni tenant : seules les politiques RLS public_read
// s'appliquent (produits publiés de vendeurs actifs). Le filtre de statut ci-dessous est redondant
// par choix (défense en profondeur), pas la seule protection.
export async function storefrontRoutes(
  app: FastifyInstance,
  options: { db: Database; mediaBaseUrl?: string },
) {
  const { db, mediaBaseUrl } = options;

  app.get(
    "/v1/catalog/products",
    {
      ...publicLimit,
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            q: { type: "string", maxLength: 100 },
            page: { type: "integer", minimum: 1, maximum: 50, default: 1 },
            lang: { enum: ["fr", "en"], default: "fr" },
          },
        },
        response: { 400: error, 429: error },
      },
    },
    async (request): Promise<CatalogPageDTO> => {
      const { q, page, lang } = request.query as {
        q?: string;
        page: number;
        lang: "fr" | "en";
      };
      const tsquery = q ? toSearchQuery(q) : null;
      if (q && !tsquery) return { items: [], page, hasMore: false };
      const offset = (page - 1) * PAGE_SIZE;
      const rows = await asRuntime(
        db,
        {},
        (tx) =>
          tx.$queryRaw<SearchRow[]>`
          SELECT p."id", p."title", s."name" AS "storeName", s."slug" AS "storeSlug",
                 price."priceFrom", price."currency",
                 coalesce(stock.available, 0)::int AS "available",
                 img."publicKey" AS "imageKey", img."altFr", img."altEn", img."width", img."height"
            FROM "Product" p
            JOIN "Store" s ON s."id" = p."storeId"
            JOIN LATERAL (
              SELECT min(v."priceMinor") AS "priceFrom", min(v."currency") AS "currency"
                FROM "ProductVariant" v WHERE v."productId" = p."id" AND v."active"
            ) price ON price."priceFrom" IS NOT NULL
            LEFT JOIN LATERAL (
              SELECT sum(sl."onHand" - sl."reserved") AS available
                FROM "ProductVariant" v JOIN "StockLevel" sl ON sl."variantId" = v."id"
               WHERE v."productId" = p."id" AND v."active"
            ) stock ON true
            LEFT JOIN LATERAL (
              SELECT m."publicKey", m."altFr", m."altEn", m."width", m."height"
                FROM "ProductMedia" m
               WHERE m."productId" = p."id" AND m."status" = 'READY'
               ORDER BY m."position" LIMIT 1
            ) img ON true
           WHERE p."status" = 'PUBLISHED'
             AND (${tsquery}::text IS NULL
                  OR p."search" @@ to_tsquery('simple', search_unaccent(${tsquery}::text)))
           ORDER BY CASE WHEN ${tsquery}::text IS NULL THEN 0
                         ELSE ts_rank(p."search", to_tsquery('simple', search_unaccent(${tsquery}::text)))
                    END DESC,
                    p."publishedAt" DESC NULLS LAST, p."id"
           LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}`,
      );
      const items: CatalogItemDTO[] = rows.slice(0, PAGE_SIZE).map((row) => {
        const url = mediaUrl(mediaBaseUrl, row.imageKey);
        const image: MediaDTO | null = url
          ? {
              url,
              alt: (lang === "en" ? row.altEn : row.altFr) ?? row.title,
              width: row.width,
              height: row.height,
            }
          : null;
        return {
          id: row.id,
          title: row.title,
          store: { name: row.storeName, slug: row.storeSlug },
          priceFrom: {
            amountMinor: row.priceFrom.toString(),
            currency: row.currency,
          },
          availability: availabilityOf(row.available),
          image,
        };
      });
      return { items, page, hasMore: rows.length > PAGE_SIZE };
    },
  );

  app.get(
    "/v1/catalog/products/:productId",
    {
      ...publicLimit,
      schema: {
        params: {
          type: "object",
          required: ["productId"],
          properties: { productId: { type: "string", format: "uuid" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { lang: { enum: ["fr", "en"], default: "fr" } },
        },
        response: { 400: error, 404: error, 429: error },
      },
    },
    async (request, reply) => {
      const { productId } = request.params as { productId: string };
      const { lang } = request.query as { lang: "fr" | "en" };
      const product = await asRuntime(db, {}, (tx) =>
        tx.product.findFirst({
          where: { id: productId, status: "PUBLISHED" },
          select: {
            id: true,
            title: true,
            description: true,
            store: { select: { name: true, slug: true } },
            variants: {
              where: { active: true },
              orderBy: { createdAt: "asc" },
              select: {
                id: true,
                label: true,
                priceMinor: true,
                currency: true,
                stock: { select: { onHand: true, reserved: true } },
              },
            },
            media: {
              where: { status: "READY" },
              orderBy: { position: "asc" },
              select: {
                publicKey: true,
                altFr: true,
                altEn: true,
                width: true,
                height: true,
              },
            },
          },
        }),
      );
      if (!product || product.variants.length === 0)
        return reply.code(404).send({ error: "not_found" });
      const body: PublicProductDTO = {
        id: product.id,
        title: product.title,
        description: product.description,
        store: product.store,
        variants: product.variants.map((v) => ({
          id: v.id,
          label: v.label,
          price: { amountMinor: v.priceMinor.toString(), currency: v.currency },
          availability: availabilityOf(
            v.stock.reduce((sum, s) => sum + s.onHand - s.reserved, 0),
          ),
        })),
        media: product.media.flatMap((m) => {
          const url = mediaUrl(mediaBaseUrl, m.publicKey);
          return url
            ? [
                {
                  url,
                  alt: lang === "en" ? m.altEn : m.altFr,
                  width: m.width,
                  height: m.height,
                },
              ]
            : [];
        }),
      };
      return body;
    },
  );
}
