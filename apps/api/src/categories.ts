import { asRuntime, type Database, type ScopedTx } from "@duoshop/database";
import type { AdminCategoryDTO, CategoryDTO } from "@duoshop/types";
import type { FastifyInstance } from "fastify";
import { errorSchema as error, requireSameOrigin } from "./guards";
import { requireStaff } from "./staff";

const uuid = { type: "string", format: "uuid" } as const;
const refusals = {
  400: error,
  401: error,
  403: error,
  404: error,
  409: error,
} as const;
const anyObject = { type: "object", additionalProperties: true } as const;
const names = {
  nameFr: { type: "string", minLength: 2, maxLength: 60 },
  nameEn: { type: "string", minLength: 2, maxLength: 60 },
  position: { type: "integer", minimum: 0, maximum: 10000 },
} as const;

function dbCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  if ("code" in err && err.code === "P2002") return "slug_taken";
  // Déclencheur « deux niveaux au plus » (23514) relayé par Prisma.
  return String((err as { message?: string }).message ?? "").includes(
    "two levels",
  ) ||
    String((err as { message?: string }).message ?? "").includes(
      "cannot become a child",
    )
    ? "invalid_parent"
    : null;
}

// Catégories actives et sous-catégories d'un identifiant public (slug).
export async function categoryScope(
  tx: ScopedTx,
  slug: string,
): Promise<string[] | null> {
  const category = await tx.category.findFirst({
    where: { slug, active: true },
    select: {
      id: true,
      children: { where: { active: true }, select: { id: true } },
    },
  });
  return category ? [category.id, ...category.children.map((c) => c.id)] : null;
}

export async function categoryRoutes(
  app: FastifyInstance,
  options: { db: Database; webOrigin: string },
) {
  const { db, webOrigin } = options;

  // ---------- Vitrine : arbre des catégories avec nombre de produits publiés ----------
  app.get(
    "/v1/catalog/categories",
    {
      config: { rateLimit: { max: 120, timeWindow: 60_000 } },
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { lang: { enum: ["fr", "en"], default: "fr" } },
        },
        response: { 200: anyObject, 400: error, 429: error },
      },
    },
    async (request) => {
      const { lang } = request.query as { lang: "fr" | "en" };
      const { categories, counts } = await asRuntime(db, {}, async (tx) => ({
        categories: await tx.category.findMany({
          where: { active: true },
          orderBy: [{ position: "asc" }, { slug: "asc" }],
        }),
        // RLS publique : seuls les produits publiés de vendeurs actifs sont comptés.
        counts: await tx.product.groupBy({
          by: ["categoryId"],
          where: { status: "PUBLISHED", categoryId: { not: null } },
          _count: { _all: true },
        }),
      }));
      const own = new Map(counts.map((c) => [c.categoryId, c._count._all]));
      const view = (c: (typeof categories)[number]): CategoryDTO => ({
        id: c.id,
        slug: c.slug,
        name: lang === "en" ? c.nameEn : c.nameFr,
        productCount: own.get(c.id) ?? 0,
        children: [],
      });
      const roots = categories.filter((c) => !c.parentId).map(view);
      for (const root of roots) {
        root.children = categories
          .filter((c) => c.parentId === root.id)
          .map(view);
        root.productCount += root.children.reduce(
          (sum, c) => sum + c.productCount,
          0,
        );
      }
      return { categories: roots };
    },
  );

  // ---------- Administration de la taxonomie ----------
  const adminView = (
    c: Awaited<ReturnType<ScopedTx["category"]["findMany"]>>[number],
  ): AdminCategoryDTO => ({
    id: c.id,
    slug: c.slug,
    parentId: c.parentId,
    nameFr: c.nameFr,
    nameEn: c.nameEn,
    position: c.position,
    active: c.active,
  });

  app.get(
    "/v1/admin/categories",
    { schema: { response: { 200: anyObject, ...refusals } } },
    async (request, reply) => {
      const staff = await requireStaff(db, request, reply, "taxonomy:manage");
      if (!staff) return reply;
      const rows = await asRuntime(
        db,
        { userId: staff.principal.userId },
        (tx) =>
          tx.category.findMany({
            orderBy: [{ position: "asc" }, { slug: "asc" }],
          }),
      );
      return { categories: rows.map(adminView) };
    },
  );

  app.post(
    "/v1/admin/categories",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["slug", "nameFr", "nameEn"],
          properties: {
            slug: {
              type: "string",
              pattern: "^[a-z0-9]+(-[a-z0-9]+)*$",
              maxLength: 60,
            },
            parentId: uuid,
            ...names,
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
        parentId?: string;
        nameFr: string;
        nameEn: string;
        position?: number;
      };
      try {
        const created = await asRuntime(
          db,
          { userId: staff.principal.userId },
          (tx) =>
            tx.category.create({
              data: {
                slug: body.slug,
                parentId: body.parentId ?? null,
                nameFr: body.nameFr.trim(),
                nameEn: body.nameEn.trim(),
                position: body.position ?? 100,
              },
            }),
        );
        return reply.code(201).send(adminView(created));
      } catch (err) {
        const code = dbCode(err);
        if (code) return reply.code(409).send({ error: code });
        throw err;
      }
    },
  );

  app.post(
    "/v1/admin/categories/:categoryId",
    {
      schema: {
        params: {
          type: "object",
          required: ["categoryId"],
          properties: { categoryId: uuid },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["nameFr", "nameEn", "position", "active"],
          properties: { ...names, active: { type: "boolean" } },
        },
        response: { 200: anyObject, ...refusals },
      },
    },
    async (request, reply) => {
      if (!(await requireSameOrigin(request, reply, webOrigin))) return reply;
      const staff = await requireStaff(db, request, reply, "taxonomy:manage");
      if (!staff) return reply;
      const { categoryId } = request.params as { categoryId: string };
      const body = request.body as {
        nameFr: string;
        nameEn: string;
        position: number;
        active: boolean;
      };
      const updated = await asRuntime(
        db,
        { userId: staff.principal.userId },
        async (tx) => {
          const { count } = await tx.category.updateMany({
            where: { id: categoryId },
            data: {
              nameFr: body.nameFr.trim(),
              nameEn: body.nameEn.trim(),
              position: body.position,
              active: body.active,
            },
          });
          return count
            ? tx.category.findUniqueOrThrow({ where: { id: categoryId } })
            : null;
        },
      );
      if (!updated) return reply.code(404).send({ error: "not_found" });
      return adminView(updated);
    },
  );
}
