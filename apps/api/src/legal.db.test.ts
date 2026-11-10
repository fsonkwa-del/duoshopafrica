import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

// Mentions légales (lot 7, ADR 0015) : contact public de la boutique, identité du vendeur vérifié
// sur la fiche produit, figée sur la commande ; jamais le nom ni le téléphone privés du propriétaire.
const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const ids = { tenants: [] as string[], users: [] as string[] };
const f = {
  verified: { storeId: "", productId: "", variantId: "", slug: "" },
  pending: { productId: "" },
  owner: "",
  catalog: "",
  buyer: "",
};

async function user() {
  const created = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(created.id);
  const { token, tokenHash } = issueSessionToken();
  await db.session.create({
    data: {
      userId: created.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return { id: created.id, token };
}
async function shop(status: "APPROVED" | "SUBMITTED") {
  const tenant = await db.tenant.create({
    data: {
      name: `TEST-legal-${status}`,
      status: status === "APPROVED" ? "ACTIVE" : "PENDING",
    },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: `Boutique ${status}`,
      pickupEnabled: true,
    },
  });
  await db.merchantVerification.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      status,
      legalName: "Ets Ngono et Fils",
      registrationNumber: "RC/DLA/2024/A/1234",
      businessType: "SOLE_PROPRIETOR",
      ownerName: "Awa Ngono",
      ownerPhone: "+237699000111",
      city: "Douala",
      district: "Akwa",
      submittedAt: new Date(),
    },
  });
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
  });
  const product = await db.product.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      title: "Pagne wax",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `L-${randomUUID().slice(0, 8)}`,
      label: "Standard",
      priceMinor: 12500n,
      currency: "XAF",
    },
  });
  await db.stockLevel.create({
    data: {
      tenantId: tenant.id,
      variantId: variant.id,
      locationId: location.id,
      onHand: 5,
    },
  });
  return { tenant, store, product, variant };
}
const call = (
  method: "GET" | "POST",
  url: string,
  token: string | null,
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

before(async () => {
  const v = await shop("APPROVED");
  f.verified = {
    storeId: v.store.id,
    productId: v.product.id,
    variantId: v.variant.id,
    slug: v.store.slug,
  };
  const owner = await user();
  const catalog = await user();
  for (const [member, role] of [
    [owner, "OWNER"],
    [catalog, "CATALOG"],
  ] as const)
    await db.storeMember.create({
      data: {
        tenantId: v.tenant.id,
        storeId: v.store.id,
        userId: member.id,
        role,
      },
    });
  f.owner = owner.token;
  f.catalog = catalog.token;
  f.buyer = (await user()).token;
  f.pending.productId = (await shop("SUBMITTED")).product.id;
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  await db.orderItem.deleteMany({ where: { tenantId } });
  await db.sellerOrder.deleteMany({ where: { tenantId } });
  await db.order.deleteMany({ where: { buyerId: userId } });
  await db.cartItem.deleteMany({ where: { cart: { userId } } });
  await db.cart.deleteMany({ where: { userId } });
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.merchantVerification.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("seller legal information", () => {
  const contactUrl = () => `/v1/stores/${f.verified.storeId}/contact`;

  test("the owner sets the public contact; other roles and bad values are refused", async () => {
    const forbidden = await call("POST", contactUrl(), f.catalog, {
      phone: "677 11 22 33",
      email: null,
    });
    assert.equal(forbidden.statusCode, 403);
    const badPhone = await call("POST", contactUrl(), f.owner, {
      phone: "12",
      email: null,
    });
    assert.equal(badPhone.statusCode, 400);
    assert.equal(badPhone.json().error, "invalid_phone");
    const badEmail = await call("POST", contactUrl(), f.owner, {
      phone: null,
      email: "boutique@",
    });
    assert.equal(badEmail.json().error, "invalid_email");
    const saved = await call("POST", contactUrl(), f.owner, {
      phone: "677 11 22 33",
      email: " Contact@Ngono.example ",
    });
    assert.equal(saved.statusCode, 200, saved.body);
    assert.deepEqual(saved.json(), {
      phone: "+237677112233",
      email: "contact@ngono.example",
    });
    const store = await call(
      "GET",
      `/v1/stores/${f.verified.storeId}`,
      f.owner,
    );
    assert.deepEqual(store.json().contact, {
      phone: "+237677112233",
      email: "contact@ngono.example",
    });
  });

  test("a verified store's product shows its legal mentions, never the owner's private details", async () => {
    const res = await call(
      "GET",
      `/v1/catalog/products/${f.verified.productId}`,
      null,
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().seller.legal, {
      legalName: "Ets Ngono et Fils",
      businessType: "SOLE_PROPRIETOR",
      registrationNumber: "RC/DLA/2024/A/1234",
      city: "Douala",
      district: "Akwa",
      contactPhone: "+237677112233",
      contactEmail: "contact@ngono.example",
    });
    assert.ok(!res.body.includes("Awa Ngono"));
    assert.ok(!res.body.includes("699000111"));
  });

  test("a store not yet verified exposes no legal mentions", async () => {
    // Boutique en attente : produit invisible en vitrine, et aucune mention calculée.
    const [row] = await db.$queryRaw<{ legal: unknown }[]>`
      SELECT store_legal_mentions(s."id") AS legal FROM "Store" s
        JOIN "Product" p ON p."storeId" = s."id" WHERE p."id" = ${f.pending.productId}::uuid`;
    assert.equal(row?.legal, null);
  });

  test("the order freezes the mentions at purchase time", async () => {
    await call("POST", "/v1/cart/items", f.buyer, {
      variantId: f.verified.variantId,
      quantity: 1,
    });
    const placed = await call("POST", "/v1/orders", f.buyer, {
      idempotencyKey: randomUUID().replaceAll("-", ""),
      deliveries: [{ storeSlug: f.verified.slug, method: "PICKUP" }],
      expectedTotalMinor: "12500",
    });
    assert.equal(placed.statusCode, 201, placed.body);
    const orderId = placed.json().id as string;
    assert.equal(
      placed.json().sellers[0].sellerLegal.registrationNumber,
      "RC/DLA/2024/A/1234",
    );
    // Le vendeur change ensuite son contact : la commande garde celui du jour de l'achat.
    await call("POST", contactUrl(), f.owner, {
      phone: "699 99 88 77",
      email: null,
    });
    const order = await call("GET", `/v1/orders/${orderId}`, f.buyer);
    assert.equal(
      order.json().sellers[0].sellerLegal.contactPhone,
      "+237677112233",
    );
    assert.equal(
      order.json().sellers[0].sellerLegal.contactEmail,
      "contact@ngono.example",
    );
  });
});
