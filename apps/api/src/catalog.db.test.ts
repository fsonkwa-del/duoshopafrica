import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const ids = { tenants: [] as string[], users: [] as string[] };
const f = {
  tenantP: "",
  storeA: "",
  storeB: "",
  owner: "",
  catalog: "",
  fulfilment: "",
  rival: "",
  productId: "",
  variantId: "",
  rivalVariantId: "",
};

async function storeOf(status: "PENDING" | "ACTIVE") {
  const tenant = await db.tenant.create({ data: { name: "TEST-B03", status } });
  ids.tenants.push(tenant.id);
  return db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "TEST B03",
    },
  });
}
async function member(
  store: { id: string; tenantId: string },
  role: "OWNER" | "CATALOG" | "FULFILLMENT",
) {
  const user = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(user.id);
  await db.storeMember.create({
    data: {
      tenantId: store.tenantId,
      storeId: store.id,
      userId: user.id,
      role,
    },
  });
  const { token, tokenHash } = issueSessionToken();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return token;
}
const call = (
  method: "GET" | "POST",
  url: string,
  token: string,
  payload?: object,
  origin: string | null = webOrigin,
) =>
  app.inject({
    method,
    url,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      ...(origin && method === "POST" ? { origin } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const tshirt = {
  title: "T-shirt wax",
  description: "Coton, imprimé local",
  variants: [
    { sku: "wax-tee-m", label: "Taille M", priceMinor: "7500" },
    { sku: "wax-tee-l", label: "Taille L", priceMinor: "8000" },
  ],
};
const stock = (
  token: string,
  storeId: string,
  variantId: string,
  body: object,
) =>
  call(
    "POST",
    `/v1/stores/${storeId}/variants/${variantId}/stock`,
    token,
    body,
  );

before(async () => {
  const a = await storeOf("PENDING");
  const b = await storeOf("ACTIVE");
  Object.assign(f, {
    tenantP: a.tenantId,
    storeA: a.id,
    storeB: b.id,
    owner: await member(a, "OWNER"),
    catalog: await member(a, "CATALOG"),
    fulfilment: await member(a, "FULFILLMENT"),
    rival: await member(b, "OWNER"),
  });
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockMovement.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.session.deleteMany({ where: { userId: { in: ids.users } } });
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
  await db.$disconnect();
});

describe("AC03 — a seller builds a catalogue", () => {
  test("a seller awaiting approval prepares a draft with variants and exact prices", async () => {
    const response = await call(
      "POST",
      `/v1/stores/${f.storeA}/products`,
      f.owner,
      tshirt,
    );
    assert.equal(response.statusCode, 201);
    const product = response.json();
    assert.equal(product.status, "DRAFT");
    assert.deepEqual(
      product.variants.map(
        (v: { sku: string; price: object; stock: object }) => [
          v.sku,
          v.price,
          v.stock,
        ],
      ),
      [
        [
          "WAX-TEE-M",
          { amountMinor: "7500", currency: "XAF" },
          { onHand: 0, reserved: 0, available: 0 },
        ],
        [
          "WAX-TEE-L",
          { amountMinor: "8000", currency: "XAF" },
          { onHand: 0, reserved: 0, available: 0 },
        ],
      ],
    );
    f.productId = product.id;
    f.variantId = product.variants[0].id;
  });

  test("rejects inexact prices, unsafe or duplicate SKUs and unknown fields", async () => {
    const variant = tshirt.variants[0] as object;
    for (const payload of [
      { ...tshirt, variants: [{ ...variant, priceMinor: "12.5" }] },
      { ...tshirt, variants: [{ ...variant, priceMinor: "0" }] },
      { ...tshirt, variants: [{ ...variant, sku: "<x>" }] },
      { ...tshirt, variants: [variant, variant] },
      { ...tshirt, featured: true },
      { ...tshirt, variants: [] },
    ])
      assert.equal(
        (
          await call(
            "POST",
            `/v1/stores/${f.storeA}/products`,
            f.owner,
            payload,
          )
        ).statusCode,
        400,
        JSON.stringify(payload),
      );
    const noOrigin = await call(
      "POST",
      `/v1/stores/${f.storeA}/products`,
      f.owner,
      tshirt,
      null,
    );
    assert.equal(noOrigin.statusCode, 403);
  });

  test("SKUs are unique per tenant, never across tenants", async () => {
    const again = await call(
      "POST",
      `/v1/stores/${f.storeA}/products`,
      f.owner,
      tshirt,
    );
    assert.equal(again.statusCode, 409);
    assert.deepEqual(again.json(), { error: "sku_taken" });
    const rival = await call(
      "POST",
      `/v1/stores/${f.storeB}/products`,
      f.rival,
      tshirt,
    );
    assert.equal(rival.statusCode, 201);
    f.rivalVariantId = rival.json().variants[0].id;
  });

  test("publishing waits for merchant approval", async () => {
    const publish = (version: number) =>
      call(
        "POST",
        `/v1/stores/${f.storeA}/products/${f.productId}/status`,
        f.owner,
        {
          status: "PUBLISHED",
          expectedVersion: version,
        },
      );
    assert.equal((await publish(0)).statusCode, 403);
    await db.tenant.update({
      where: { id: f.tenantP },
      data: { status: "ACTIVE" },
    });
    assert.equal((await publish(0)).statusCode, 200);
    assert.equal((await publish(0)).statusCode, 409);
    const archive = await call(
      "POST",
      `/v1/stores/${f.storeA}/products/${f.productId}/status`,
      f.owner,
      {
        status: "ARCHIVED",
        expectedVersion: 1,
      },
    );
    assert.equal(archive.statusCode, 200);
    const republish = await publish(2);
    assert.equal(republish.statusCode, 409);
    assert.deepEqual(republish.json(), { error: "invalid_transition" });
  });

  test("roles: catalogue staff edit products, fulfilment staff handle stock", async () => {
    const other = {
      ...tshirt,
      variants: [{ sku: "bag-1", label: "Sac", priceMinor: "12000" }],
    };
    assert.equal(
      (
        await call(
          "POST",
          `/v1/stores/${f.storeA}/products`,
          f.fulfilment,
          other,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await call("POST", `/v1/stores/${f.storeA}/products`, f.catalog, other))
        .statusCode,
      201,
    );
    const receipt = {
      delta: 5,
      reason: "RECEIPT",
      idempotencyKey: "role-check-1",
    };
    assert.equal(
      (await stock(f.catalog, f.storeA, f.variantId, receipt)).statusCode,
      403,
    );
    assert.equal(
      (await stock(f.fulfilment, f.storeA, f.variantId, receipt)).statusCode,
      200,
    );
  });
});

describe("stock movements through the API", () => {
  test("a receipt is idempotent and a reused key with another quantity conflicts", async () => {
    const receipt = {
      delta: 10,
      reason: "RECEIPT",
      idempotencyKey: "reception-2026-001",
    };
    const first = await stock(f.owner, f.storeA, f.variantId, receipt);
    const replay = await stock(f.owner, f.storeA, f.variantId, receipt);
    assert.deepEqual(first.json(), {
      replayed: false,
      stock: { onHand: 15, reserved: 0, available: 15 },
    });
    assert.deepEqual(replay.json(), {
      replayed: true,
      stock: { onHand: 15, reserved: 0, available: 15 },
    });
    const misuse = await stock(f.owner, f.storeA, f.variantId, {
      ...receipt,
      delta: 3,
    });
    assert.equal(misuse.statusCode, 409);
    assert.deepEqual(misuse.json(), { error: "idempotency_conflict" });
  });

  test("refuses impossible movements", async () => {
    const tooMuch = await stock(f.owner, f.storeA, f.variantId, {
      delta: -16,
      reason: "ADJUSTMENT",
      idempotencyKey: "inventaire-0001",
    });
    assert.equal(tooMuch.statusCode, 409);
    assert.deepEqual(tooMuch.json(), { error: "insufficient_stock" });
    for (const body of [
      { delta: -1, reason: "RECEIPT", idempotencyKey: "negative-rcpt" },
      { delta: 0, reason: "ADJUSTMENT", idempotencyKey: "zero-delta-1" },
      { delta: 1.5, reason: "ADJUSTMENT", idempotencyKey: "fraction-001" },
      { delta: 1, reason: "ADJUSTMENT", idempotencyKey: "short" },
    ])
      assert.equal(
        (await stock(f.owner, f.storeA, f.variantId, body)).statusCode,
        400,
        JSON.stringify(body),
      );
  });
});

describe("price history and isolation", () => {
  test("a price change is versioned and its history audited", async () => {
    const change = (priceMinor: string, expectedVersion: number) =>
      call(
        "POST",
        `/v1/stores/${f.storeA}/variants/${f.variantId}/price`,
        f.owner,
        {
          priceMinor,
          expectedVersion,
        },
      );
    assert.equal((await change("6900", 0)).statusCode, 200);
    assert.equal((await change("6500", 0)).statusCode, 409);
    assert.equal((await change("65.5", 1)).statusCode, 400);
    const history = await db.auditLog.findFirstOrThrow({
      where: { resourceId: f.variantId, action: "catalog.price.change" },
    });
    assert.deepEqual(history.detail, {
      sku: "WAX-TEE-M",
      currency: "XAF",
      from: "7500",
      to: "6900",
    });
  });

  test("another tenant can neither read nor touch this catalogue, even with guessed ids", async () => {
    assert.equal(
      (await call("GET", `/v1/stores/${f.storeA}/products`, f.rival))
        .statusCode,
      404,
    );
    const viaOwnStore = await stock(f.rival, f.storeB, f.variantId, {
      delta: -15,
      reason: "ADJUSTMENT",
      idempotencyKey: "cross-tenant-1",
    });
    assert.equal(viaOwnStore.statusCode, 404);
    const intoRival = await call(
      "POST",
      `/v1/stores/${f.storeA}/variants/${f.rivalVariantId}/price`,
      f.owner,
      {
        priceMinor: "1",
        expectedVersion: 0,
      },
    );
    assert.equal(intoRival.statusCode, 404);
    const listed = (
      await call("GET", `/v1/stores/${f.storeA}/products`, f.owner)
    ).json();
    const variant = listed.products
      .flatMap((p: { variants: { id: string; stock: object }[] }) => p.variants)
      .find((v: { id: string }) => v.id === f.variantId);
    assert.deepEqual(variant.stock, { onHand: 15, reserved: 0, available: 15 });
  });

  test("a suspended seller can no longer change anything", async () => {
    await db.tenant.update({
      where: { id: f.tenantP },
      data: { status: "SUSPENDED" },
    });
    const listing = await call(
      "GET",
      `/v1/stores/${f.storeA}/products`,
      f.owner,
    );
    assert.equal(listing.statusCode, 403);
    assert.deepEqual(listing.json(), { error: "store_unavailable" });
    const move = await stock(f.owner, f.storeA, f.variantId, {
      delta: 1,
      reason: "RECEIPT",
      idempotencyKey: "after-suspend",
    });
    assert.equal(move.statusCode, 403);
  });
});
