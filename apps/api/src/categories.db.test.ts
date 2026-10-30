import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const suffix = randomUUID().slice(0, 6);
const ids = { tenant: "", users: [] as string[], categories: [] as string[] };
const f = {
  storeId: "",
  productId: "",
  catalog: "",
  stranger: "",
  admin: "",
  support: "",
  fabrics: "",
};

async function user(platform?: "ADMIN" | "SUPPORT") {
  const created = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(created.id);
  if (platform)
    await db.platformMember.create({
      data: { userId: created.id, role: platform },
    });
  const { token, tokenHash } = issueSessionToken();
  await db.session.create({
    data: {
      userId: created.id,
      tokenHash,
      mfa: Boolean(platform),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return { id: created.id, token };
}
const call = (
  method: "GET" | "POST",
  url: string,
  token?: string,
  payload?: object,
) =>
  app.inject({
    method,
    url,
    headers: {
      ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
      ...(method === "POST" ? { origin: webOrigin } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const titles = async (query: string) =>
  (
    (await call("GET", `/v1/catalog/products?${query}`)).json().items as {
      id: string;
    }[]
  ).map((i) => i.id);

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-CATEGORIES", status: "ACTIVE" },
  });
  ids.tenant = tenant.id;
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Atelier",
    },
  });
  f.storeId = store.id;
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
  });
  const fabrics = await db.category.findUniqueOrThrow({
    where: { slug: "tissus-pagnes" },
  });
  f.fabrics = fabrics.id;
  const product = await db.product.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      title: `Pagne catégorie ${suffix}`,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  f.productId = product.id;
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `CAT-${suffix}`,
      label: "6 yards",
      priceMinor: 9000n,
      currency: "XAF",
    },
  });
  await db.stockLevel.create({
    data: {
      tenantId: tenant.id,
      variantId: variant.id,
      locationId: location.id,
      onHand: 3,
    },
  });
  const catalog = await user();
  await db.storeMember.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      userId: catalog.id,
      role: "CATALOG",
    },
  });
  Object.assign(f, {
    catalog: catalog.token,
    stranger: (await user()).token,
    admin: (await user("ADMIN")).token,
    support: (await user("SUPPORT")).token,
  });
});

after(async () => {
  await app.close();
  const tenantId = ids.tenant;
  const userId = { in: ids.users };
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.delete({ where: { id: tenantId } });
  // Enfants d'abord (clé étrangère parentId).
  await db.category.deleteMany({
    where: { id: { in: ids.categories }, parentId: { not: null } },
  });
  await db.category.deleteMany({ where: { id: { in: ids.categories } } });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("categorising products", () => {
  test("only store staff with catalog rights assign an active category", async () => {
    const url = `/v1/stores/${f.storeId}/products/${f.productId}/category`;
    assert.equal(
      (await call("POST", url, f.stranger, { categoryId: f.fabrics }))
        .statusCode,
      404,
    );
    assert.equal(
      (await call("POST", url, f.catalog, { categoryId: randomUUID() })).json()
        .error,
      "invalid_category",
    );
    const set = await call("POST", url, f.catalog, { categoryId: f.fabrics });
    assert.equal(set.statusCode, 200, set.body);
    assert.equal(set.json().categoryId, f.fabrics);
  });

  test("the public tree counts published products in parents and children", async () => {
    const res = await call("GET", "/v1/catalog/categories?lang=en");
    const roots = res.json().categories as {
      slug: string;
      name: string;
      productCount: number;
      children: { slug: string; productCount: number }[];
    }[];
    assert.ok(roots.length >= 6);
    const mode = roots.find((r) => r.slug === "mode");
    const child = mode?.children.find((c) => c.slug === "tissus-pagnes");
    assert.equal(mode?.name, "Fashion and fabrics");
    assert.ok((child?.productCount ?? 0) >= 1);
    assert.ok((mode?.productCount ?? 0) >= (child?.productCount ?? 0));
  });

  test("filtering by a parent includes its children; unknown slugs return nothing", async () => {
    assert.ok((await titles("category=mode")).includes(f.productId));
    assert.ok((await titles("category=tissus-pagnes")).includes(f.productId));
    assert.ok(!(await titles("category=alimentation")).includes(f.productId));
    assert.deepEqual(await titles("category=inconnue"), []);
    assert.equal(
      (await call("GET", "/v1/catalog/products?category=Bad%20Slug"))
        .statusCode,
      400,
    );
    const detail = await call(
      "GET",
      `/v1/catalog/products/${f.productId}?lang=fr`,
    );
    assert.deepEqual(detail.json().category, {
      slug: "tissus-pagnes",
      name: "Tissus et pagnes",
      parent: { slug: "mode", name: "Mode et pagnes" },
    });
  });
});

describe("managing the taxonomy", () => {
  test("only admins manage; two levels at most; unique slugs", async () => {
    const url = "/v1/admin/categories";
    const body = {
      slug: `test-${suffix}`,
      nameFr: "Catégorie de test",
      nameEn: "Test category",
    };
    assert.equal((await call("POST", url, f.support, body)).statusCode, 403);
    assert.equal((await call("GET", url, f.stranger)).statusCode, 404);
    const root = await call("POST", url, f.admin, body);
    assert.equal(root.statusCode, 201, root.body);
    ids.categories.push(root.json().id);
    assert.equal(
      (await call("POST", url, f.admin, body)).json().error,
      "slug_taken",
    );
    const child = await call("POST", url, f.admin, {
      ...body,
      slug: `test-${suffix}-child`,
      parentId: root.json().id,
    });
    assert.equal(child.statusCode, 201);
    ids.categories.push(child.json().id);
    const grandChild = await call("POST", url, f.admin, {
      ...body,
      slug: `test-${suffix}-deep`,
      parentId: child.json().id,
    });
    assert.equal(grandChild.json().error, "invalid_parent");
  });

  test("a deactivated category disappears from the shop and its filter", async () => {
    const category = await db.category.findUniqueOrThrow({
      where: { slug: `test-${suffix}-child` },
    });
    await db.product.update({
      where: { id: f.productId },
      data: { categoryId: category.id },
    });
    assert.ok((await titles(`category=test-${suffix}`)).includes(f.productId));
    const off = await call(
      "POST",
      `/v1/admin/categories/${category.id}`,
      f.admin,
      { nameFr: "Désactivée", nameEn: "Disabled", position: 1, active: false },
    );
    assert.equal(off.statusCode, 200, off.body);
    assert.ok(!(await titles(`category=test-${suffix}`)).includes(f.productId));
    assert.deepEqual(await titles(`category=test-${suffix}-child`), []);
    const detail = await call("GET", `/v1/catalog/products/${f.productId}`);
    assert.equal(detail.json().category, null);
    await db.product.update({
      where: { id: f.productId },
      data: { categoryId: null },
    });
  });
});
