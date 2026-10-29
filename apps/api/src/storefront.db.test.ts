import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";
import { PAGE_SIZE } from "./storefront";

const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const ids = { tenants: [] as string[], users: [] as string[] };
// Mot rare propre à ce test : les recherches ne dépendent pas d'autres données de la base.
const token = `kribi${randomUUID()
  .replace(/[^a-f]/g, "")
  .slice(0, 6)}`;
const f = {
  activeTenant: "",
  published: "",
  soldOut: "",
  draft: "",
  hidden: [] as string[],
  v1: "",
  v2: "",
  vDraft: "",
  buyer: "",
  buyerB: "",
};

async function tenantStore(
  status: "ACTIVE" | "PENDING" | "SUSPENDED",
  name: string,
) {
  const tenant = await db.tenant.create({
    data: { name: `TEST-${name}`, status },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: { tenantId: tenant.id, slug: `test-${randomUUID()}`, name },
  });
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
  });
  return { tenantId: tenant.id, storeId: store.id, locationId: location.id };
}
async function product(
  at: Awaited<ReturnType<typeof tenantStore>>,
  title: string,
  status: "DRAFT" | "PUBLISHED" | "ARCHIVED",
  variants: { price: bigint; onHand: number; active?: boolean }[],
) {
  const created = await db.product.create({
    data: {
      tenantId: at.tenantId,
      storeId: at.storeId,
      title,
      description: "Coton imprimé, fabrication locale",
      status,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
    },
  });
  const variantIds: string[] = [];
  for (const [i, v] of variants.entries()) {
    const variant = await db.productVariant.create({
      data: {
        tenantId: at.tenantId,
        productId: created.id,
        sku: `T-${randomUUID().slice(0, 8)}-${i}`,
        label: `Variante ${i + 1}`,
        priceMinor: v.price,
        currency: "XAF",
        active: v.active ?? true,
      },
    });
    await db.stockLevel.create({
      data: {
        tenantId: at.tenantId,
        variantId: variant.id,
        locationId: at.locationId,
        onHand: v.onHand,
      },
    });
    variantIds.push(variant.id);
  }
  return { id: created.id, variantIds };
}
async function buyer() {
  const user = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(user.id);
  const { token: session, tokenHash } = issueSessionToken();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return session;
}
const search = (query: string) =>
  app.inject(
    `/v1/catalog/products?${new URLSearchParams(query ? { q: query } : {})}`,
  );
const cart = (session: string) =>
  app.inject({
    url: "/v1/cart",
    headers: { cookie: `${SESSION_COOKIE}=${session}` },
  });
const setLine = (
  session: string,
  variantId: string,
  quantity: number,
  origin = webOrigin,
) =>
  app.inject({
    method: "POST",
    url: "/v1/cart/items",
    headers: { cookie: `${SESSION_COOKIE}=${session}`, origin },
    payload: { variantId, quantity },
  });

before(async () => {
  const active = await tenantStore("ACTIVE", "Atelier Awa");
  const pending = await tenantStore("PENDING", "En attente");
  const suspended = await tenantStore("SUSPENDED", "Suspendue");
  f.activeTenant = active.tenantId;
  const p1 = await product(active, `Pagne wax élégant ${token}`, "PUBLISHED", [
    { price: 12500n, onHand: 10 },
    { price: 13000n, onHand: 2 },
  ]);
  const p2 = await product(active, `Sac en raphia ${token}`, "PUBLISHED", [
    { price: 9000n, onHand: 0 },
  ]);
  const draft = await product(active, `Brouillon ${token}`, "DRAFT", [
    { price: 1000n, onHand: 5 },
  ]);
  const archived = await product(active, `Archive ${token}`, "ARCHIVED", [
    { price: 1000n, onHand: 5 },
  ]);
  const noVariant = await product(
    active,
    `Sans variante ${token}`,
    "PUBLISHED",
    [{ price: 1000n, onHand: 5, active: false }],
  );
  const ofPending = await product(
    pending,
    `Pagne caché ${token}`,
    "PUBLISHED",
    [{ price: 1000n, onHand: 5 }],
  );
  const ofSuspended = await product(
    suspended,
    `Pagne suspendu ${token}`,
    "PUBLISHED",
    [{ price: 1000n, onHand: 5 }],
  );
  Object.assign(f, {
    published: p1.id,
    soldOut: p2.id,
    draft: draft.id,
    hidden: [draft.id, archived.id, noVariant.id, ofPending.id, ofSuspended.id],
    v1: p1.variantIds[0],
    v2: p1.variantIds[1],
    vDraft: draft.variantIds[0],
    buyer: await buyer(),
    buyerB: await buyer(),
  });
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  await db.cartItem.deleteMany({ where: { cart: { userId } } });
  await db.cart.deleteMany({ where: { userId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("AC04 — public storefront and search", () => {
  test("lists only published products of active sellers, without signing in", async () => {
    const response = await search(token);
    assert.equal(response.statusCode, 200);
    const found = response
      .json()
      .items.map((i: { id: string }) => i.id)
      .sort();
    assert.deepEqual(found, [f.published, f.soldOut].sort());
  });

  test("search ignores accents and matches word beginnings", async () => {
    for (const query of [
      `elegant ${token}`,
      `ÉLÉGANT ${token}`,
      `pag ${token}`,
    ])
      assert.deepEqual(
        (await search(query)).json().items.map((i: { id: string }) => i.id),
        [f.published],
        query,
      );
    assert.deepEqual((await search(`introuvable ${token}`)).json().items, []);
    const hostile = await search(`'); DROP TABLE "Product"; -- ${token}`);
    assert.equal(hostile.statusCode, 200);
  });

  test("shows prices exactly and availability as levels, never quantities", async () => {
    const items = (await search(token)).json().items;
    const pagne = items.find((i: { id: string }) => i.id === f.published);
    const sac = items.find((i: { id: string }) => i.id === f.soldOut);
    assert.deepEqual(pagne.priceFrom, {
      amountMinor: "12500",
      currency: "XAF",
    });
    assert.equal(pagne.availability, "in_stock");
    assert.equal(sac.availability, "out_of_stock");
    const detail = await app.inject(`/v1/catalog/products/${f.published}`);
    assert.deepEqual(
      detail
        .json()
        .variants.map((v: { availability: string }) => v.availability),
      ["in_stock", "low_stock"],
    );
    assert.doesNotMatch(detail.body, /onHand|reserved|tenantId|sku/);
  });

  test("hidden products are indistinguishable from missing ones", async () => {
    for (const id of [...f.hidden, randomUUID()]) {
      const response = await app.inject(`/v1/catalog/products/${id}`);
      assert.equal(response.statusCode, 404, id);
    }
    assert.equal(
      (await app.inject("/v1/catalog/products/not-a-uuid")).statusCode,
      400,
    );
  });

  test("paginates by fixed pages", async () => {
    const at = await tenantStore("ACTIVE", "Grossiste");
    for (let i = 0; i < PAGE_SIZE + 1; i++)
      await product(at, `Lot ${i} ${token}x`, "PUBLISHED", [
        { price: 500n, onHand: 1 },
      ]);
    const first = (
      await app.inject(`/v1/catalog/products?q=${token}x&page=1`)
    ).json();
    const second = (
      await app.inject(`/v1/catalog/products?q=${token}x&page=2`)
    ).json();
    assert.equal(first.items.length, PAGE_SIZE);
    assert.equal(first.hasMore, true);
    assert.equal(second.items.length, 1);
    assert.equal(second.hasMore, false);
    assert.equal(
      (await app.inject("/v1/catalog/products?page=51")).statusCode,
      400,
    );
  });
});

describe("cart", () => {
  // Sans compte : panier vide consultable (le panier visiteur est couvert par guest-cart.db.test.ts).
  test("is readable without an account and only writable from the site origin", async () => {
    const anonymous = await app.inject("/v1/cart");
    assert.equal(anonymous.statusCode, 200);
    assert.equal(anonymous.json().itemCount, 0);
    assert.equal(
      (await setLine(f.buyer, f.v1, 1, "https://evil.example")).statusCode,
      403,
    );
  });

  test("groups lines by seller with exact totals", async () => {
    await setLine(f.buyer, f.v1, 2);
    const body = (await setLine(f.buyer, f.v2, 1)).json();
    assert.equal(body.groups.length, 1);
    assert.equal(body.groups[0].store.name, "Atelier Awa");
    assert.deepEqual(body.groups[0].subtotal, {
      amountMinor: "38000",
      currency: "XAF",
    });
    assert.deepEqual(body.total, { amountMinor: "38000", currency: "XAF" });
    assert.equal(body.itemCount, 3);
  });

  test("refuses hidden products and out-of-range quantities", async () => {
    assert.equal((await setLine(f.buyer, f.vDraft, 1)).statusCode, 404);
    assert.equal((await setLine(f.buyer, f.v1, 100)).statusCode, 400);
    assert.equal((await setLine(f.buyer, f.v1, -1)).statusCode, 400);
  });

  test("flags a price change until the buyer confirms the quantity", async () => {
    await db.productVariant.update({
      where: { id: f.v1 },
      data: { priceMinor: 11000n },
    });
    const line = (await cart(f.buyer))
      .json()
      .groups[0].lines.find((l: { variantId: string }) => l.variantId === f.v1);
    assert.equal(line.status, "price_changed");
    assert.deepEqual(line.previousUnitPrice, {
      amountMinor: "12500",
      currency: "XAF",
    });
    assert.deepEqual(line.lineTotal, { amountMinor: "22000", currency: "XAF" });
    const confirmed = (await setLine(f.buyer, f.v1, 2)).json();
    assert.equal(
      confirmed.groups[0].lines.find(
        (l: { variantId: string }) => l.variantId === f.v1,
      ).status,
      "ok",
    );
  });

  test("flags lines beyond available stock without revealing the quantity", async () => {
    const body = (await setLine(f.buyer, f.v2, 5)).json();
    const line = body.groups[0].lines.find(
      (l: { variantId: string }) => l.variantId === f.v2,
    );
    assert.equal(line.status, "insufficient_stock");
    assert.doesNotMatch(JSON.stringify(body), /onHand|reserved|"available"/);
  });

  test("a double click on add creates a single line", async () => {
    await setLine(f.buyerB, f.v1, 0);
    const [a, b] = await Promise.all([
      setLine(f.buyerB, f.v1, 1),
      setLine(f.buyerB, f.v1, 1),
    ]);
    assert.deepEqual([a.statusCode, b.statusCode], [200, 200]);
    const lines = (await cart(f.buyerB)).json().groups[0].lines;
    assert.equal(lines.length, 1);
    assert.equal(lines[0].quantity, 1);
  });

  test("each buyer sees only their own cart", async () => {
    const other = (await cart(f.buyerB)).json();
    assert.equal(other.itemCount, 1);
    assert.equal((await cart(f.buyer)).json().itemCount, 7);
  });

  test("a seller suspended after the add makes its lines unavailable and leaves the total", async () => {
    await db.tenant.update({
      where: { id: f.activeTenant },
      data: { status: "SUSPENDED" },
    });
    const body = (await cart(f.buyer)).json();
    assert.equal(body.groups.length, 0);
    assert.equal(body.unavailable.length, 2);
    assert.equal(body.unavailable[0].title, null);
    assert.deepEqual(body.total, { amountMinor: "0", currency: "XAF" });
    const removed = (await setLine(f.buyer, f.v1, 0)).json();
    assert.equal(removed.unavailable.length, 1);
  });
});
