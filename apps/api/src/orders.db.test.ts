import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  createDatabase,
  expireUnpaidOrders,
  issueSessionToken,
} from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

const db = createDatabase({ max: 6 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const ids = { tenants: [] as string[], users: [] as string[] };
const f = {
  storeA: { id: "", slug: "" },
  storeB: { id: "", slug: "" },
  variantA: "",
  variantB: "",
  sellerA: "",
  sellerB: "",
  catalogA: "",
  x: "",
  y: "",
  addressX: "",
  addressY: "",
  orderX: "",
};

async function session(userId: string) {
  const { token, tokenHash } = issueSessionToken();
  await db.session.create({
    data: { userId, tokenHash, expiresAt: new Date(Date.now() + 3600_000) },
  });
  return token;
}
async function user() {
  const created = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(created.id);
  return created;
}
async function store(
  name: string,
  options: { fee: bigint | null; pickup: boolean; instructions?: string },
  product: { title: string; price: bigint; onHand: number },
) {
  const tenant = await db.tenant.create({
    data: { name: `TEST-${name}`, status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const created = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name,
      deliveryFeeMinor: options.fee,
      pickupEnabled: options.pickup,
      pickupInstructions: options.instructions ?? null,
    },
  });
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: created.id, name: "Principal" },
  });
  const item = await db.product.create({
    data: {
      tenantId: tenant.id,
      storeId: created.id,
      title: product.title,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: item.id,
      sku: `O-${randomUUID().slice(0, 8)}`,
      label: "Standard",
      priceMinor: product.price,
      currency: "XAF",
    },
  });
  await db.stockLevel.create({
    data: {
      tenantId: tenant.id,
      variantId: variant.id,
      locationId: location.id,
      onHand: product.onHand,
    },
  });
  const owner = await user();
  await db.storeMember.create({
    data: {
      tenantId: tenant.id,
      storeId: created.id,
      userId: owner.id,
      role: "OWNER",
    },
  });
  const catalog = await user();
  await db.storeMember.create({
    data: {
      tenantId: tenant.id,
      storeId: created.id,
      userId: catalog.id,
      role: "CATALOG",
    },
  });
  return {
    store: { id: created.id, slug: created.slug },
    variantId: variant.id,
    ownerToken: await session(owner.id),
    catalogToken: await session(catalog.id),
  };
}
const call = (
  method: "GET" | "POST",
  url: string,
  token: string,
  payload?: object,
) =>
  app.inject({
    method,
    url,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      ...(method === "POST" ? { origin: webOrigin } : {}),
    },
    ...(payload ? { payload } : {}),
  });
const setLine = (token: string, variantId: string, quantity: number) =>
  call("POST", "/v1/cart/items", token, { variantId, quantity });
const reserved = async (variantId: string) =>
  (await db.stockLevel.findFirstOrThrow({ where: { variantId } })).reserved;
const deliveries = () => [
  { storeSlug: f.storeA.slug, method: "HOME_DELIVERY" },
  { storeSlug: f.storeB.slug, method: "PICKUP" },
];
const key = () => randomUUID().replaceAll("-", "");
const place = (token: string, body: object) =>
  call("POST", "/v1/orders", token, body);

before(async () => {
  const a = await store(
    "Atelier Awa",
    { fee: 1500n, pickup: true, instructions: "Marché Mboppi, allée 4" },
    { title: "Pagne wax", price: 12500n, onHand: 3 },
  );
  const b = await store(
    "Épicerie Bonabéri",
    { fee: null, pickup: true, instructions: "Face pharmacie du rond-point" },
    { title: "Poivre de Penja", price: 8000n, onHand: 10 },
  );
  const x = await user();
  const y = await user();
  Object.assign(f, {
    storeA: a.store,
    storeB: b.store,
    variantA: a.variantId,
    variantB: b.variantId,
    sellerA: a.ownerToken,
    sellerB: b.ownerToken,
    catalogA: a.catalogToken,
    x: await session(x.id),
    y: await session(y.id),
  });
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  await db.orderItem.deleteMany({ where: { tenantId } });
  await db.sellerOrder.deleteMany({ where: { tenantId } });
  await db.order.deleteMany({ where: { buyerId: userId } });
  await db.address.deleteMany({ where: { userId } });
  await db.cartItem.deleteMany({ where: { cart: { userId } } });
  await db.cart.deleteMany({ where: { userId } });
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("addresses adapted to local usage", () => {
  const address = {
    label: "Maison",
    recipientName: "Awa Ngono",
    phone: "699 12 34 56",
    city: "Douala",
    district: "Bonamoussadi",
    landmark: "Derrière la station Total, portail bleu",
    latitude: 4.0912345,
    longitude: 9.7412345,
  };
  test("requires a landmark and a valid Cameroonian phone; coordinates are optional and coarse", async () => {
    for (const bad of [
      { ...address, phone: "12345" },
      { ...address, landmark: "" },
      { ...address, longitude: undefined },
      { ...address, extra: "x" },
    ])
      assert.equal(
        (await call("POST", "/v1/addresses", f.x, bad)).statusCode,
        400,
        JSON.stringify(bad),
      );
    const created = await call("POST", "/v1/addresses", f.x, address);
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().phone, "+237699123456");
    assert.equal(created.json().hasCoordinates, true);
    f.addressX = created.json().id;
    const row = await db.address.findUniqueOrThrow({
      where: { id: f.addressX },
    });
    assert.equal(row.latitude?.toString(), "4.0912");
    const { latitude: _lat, longitude: _lng, ...noGps } = address;
    f.addressY = (await call("POST", "/v1/addresses", f.y, noGps)).json().id;
  });

  test("each buyer only sees and archives their own addresses", async () => {
    const list = (await call("GET", "/v1/addresses", f.y)).json().addresses;
    assert.deepEqual(
      list.map((a: { id: string }) => a.id),
      [f.addressY],
    );
    assert.equal(
      (await call("POST", `/v1/addresses/${f.addressX}/archive`, f.y))
        .statusCode,
      404,
    );
  });
});

describe("checkout quote", () => {
  test("offers each seller's own delivery options", async () => {
    await setLine(f.x, f.variantA, 2);
    await setLine(f.x, f.variantB, 1);
    const options = (await call("GET", "/v1/checkout", f.x)).json().options;
    const a = options.find(
      (o: { store: { slug: string } }) => o.store.slug === f.storeA.slug,
    );
    const b = options.find(
      (o: { store: { slug: string } }) => o.store.slug === f.storeB.slug,
    );
    assert.deepEqual(a.homeDelivery, {
      fee: { amountMinor: "1500", currency: "XAF" },
    });
    assert.equal(b.homeDelivery, null);
    assert.equal(b.pickup.instructions, "Face pharmacie du rond-point");
  });

  test("quotes exact totals and refuses impossible choices", async () => {
    const quote = await call("POST", "/v1/checkout/quote", f.x, {
      deliveries: deliveries(),
      addressId: f.addressX,
    });
    assert.equal(quote.statusCode, 200);
    assert.deepEqual(
      [
        quote.json().itemsTotal.amountMinor,
        quote.json().deliveryTotal.amountMinor,
        quote.json().total.amountMinor,
      ],
      ["33000", "1500", "34500"],
    );
    const cases: [object, string][] = [
      [
        { deliveries: [deliveries()[0]], addressId: f.addressX },
        "delivery_choice_missing",
      ],
      [
        {
          deliveries: [
            deliveries()[0],
            { storeSlug: f.storeB.slug, method: "HOME_DELIVERY" },
          ],
          addressId: f.addressX,
        },
        "delivery_unavailable",
      ],
      [{ deliveries: deliveries() }, "address_required"],
      [
        { deliveries: deliveries(), addressId: f.addressY },
        "address_not_found",
      ],
    ];
    for (const [body, code] of cases) {
      const response = await call("POST", "/v1/checkout/quote", f.x, body);
      assert.equal(response.statusCode, 409, code);
      assert.deepEqual(response.json(), { error: code });
    }
  });
});

describe("placing an order (B05)", () => {
  test("a changed total orders nothing and reserves nothing", async () => {
    const response = await place(f.x, {
      idempotencyKey: key(),
      deliveries: deliveries(),
      addressId: f.addressX,
      expectedTotalMinor: "34000",
    });
    assert.deepEqual(response.json(), { error: "total_changed" });
    assert.equal(await reserved(f.variantA), 0);
    assert.equal((await call("GET", "/v1/cart", f.x)).json().itemCount, 3);
  });

  test("creates a parent order and one sub-order per seller, reserves stock, empties the cart", async () => {
    const body = {
      idempotencyKey: key(),
      deliveries: deliveries(),
      addressId: f.addressX,
      expectedTotalMinor: "34500",
    };
    const response = await place(f.x, body);
    assert.equal(response.statusCode, 201);
    const order = response.json();
    f.orderX = order.id;
    assert.equal(order.status, "AWAITING_PAYMENT");
    assert.equal(order.total.amountMinor, "34500");
    assert.deepEqual(
      order.sellers
        .map((s: { storeName: string; deliveryMethod: string }) => [
          s.storeName,
          s.deliveryMethod,
        ])
        .sort(),
      [
        ["Atelier Awa", "HOME_DELIVERY"],
        ["Épicerie Bonabéri", "PICKUP"],
      ],
    );
    assert.equal(await reserved(f.variantA), 2);
    assert.equal(await reserved(f.variantB), 1);
    assert.equal((await call("GET", "/v1/cart", f.x)).json().itemCount, 0);
    const stored = await db.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    assert.equal(
      (stored.addressSnapshot as { landmark: string }).landmark,
      "Derrière la station Total, portail bleu",
    );

    const replay = await place(f.x, body);
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().id, order.id);
    const misuse = await place(f.x, { ...body, expectedTotalMinor: "1" });
    assert.deepEqual(misuse.json(), { error: "idempotency_conflict" });
    assert.equal(
      await db.order.count({ where: { buyerId: stored.buyerId } }),
      1,
    );
  });

  test("sellers see only their own sub-order, without the buyer's personal data", async () => {
    const forA = await call(
      "GET",
      `/v1/stores/${f.storeA.id}/orders`,
      f.sellerA,
    );
    assert.equal(forA.statusCode, 200);
    assert.equal(forA.json().orders.length, 1);
    assert.equal(forA.json().orders[0].items[0].title, "Pagne wax");
    assert.equal(forA.json().orders[0].orderId, f.orderX);
    assert.doesNotMatch(
      forA.body,
      /699123456|Bonamoussadi|portail bleu|Poivre/,
    );
    assert.equal(
      (await call("GET", `/v1/stores/${f.storeB.id}/orders`, f.sellerA))
        .statusCode,
      404,
    );
    assert.equal(
      (await call("GET", `/v1/orders/${f.orderX}`, f.y)).statusCode,
      404,
    );
  });

  test("a price change after the quote blocks the order until the buyer confirms", async () => {
    await setLine(f.y, f.variantB, 1);
    await db.productVariant.update({
      where: { id: f.variantB },
      data: { priceMinor: 8500n },
    });
    const response = await place(f.y, {
      idempotencyKey: key(),
      deliveries: [{ storeSlug: f.storeB.slug, method: "PICKUP" }],
      expectedTotalMinor: "8000",
    });
    assert.deepEqual(response.json(), { error: "cart_needs_attention" });
    await setLine(f.y, f.variantB, 1);
    const confirmed = await place(f.y, {
      idempotencyKey: key(),
      deliveries: [{ storeSlug: f.storeB.slug, method: "PICKUP" }],
      expectedTotalMinor: "8500",
    });
    assert.equal(confirmed.statusCode, 201);
  });

  test("two buyers racing for the last piece: exactly one order", async () => {
    // 3 en stock, 2 réservées par la commande de X : il en reste 1.
    const buyers = [await user(), await user()];
    const tokens = await Promise.all(buyers.map((b) => session(b.id)));
    for (const token of tokens) await setLine(token, f.variantA, 1);
    const results = await Promise.all(
      tokens.map((token) =>
        place(token, {
          idempotencyKey: key(),
          deliveries: [{ storeSlug: f.storeA.slug, method: "PICKUP" }],
          expectedTotalMinor: "12500",
        }),
      ),
    );
    assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
    assert.ok(
      results.some(
        (r) => r.statusCode === 409 && r.json().error === "insufficient_stock",
      ),
    );
    assert.equal(await reserved(f.variantA), 3);
  });

  test("a double submission at the same instant creates a single order", async () => {
    const buyer = await user();
    const token = await session(buyer.id);
    await setLine(token, f.variantB, 2);
    const body = {
      idempotencyKey: key(),
      deliveries: [{ storeSlug: f.storeB.slug, method: "PICKUP" }],
      expectedTotalMinor: "17000",
    };
    const [a, b] = await Promise.all([place(token, body), place(token, body)]);
    assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 201]);
    assert.equal(a.json().id, b.json().id);
    assert.equal(await db.order.count({ where: { buyerId: buyer.id } }), 1);
  });
});

describe("unpaid order lifecycle", () => {
  test("the buyer cancels: stock is released once, sub-orders follow", async () => {
    const before = await reserved(f.variantA);
    assert.equal(
      (await call("POST", `/v1/orders/${f.orderX}/cancel`, f.y)).statusCode,
      404,
    );
    const cancel = await call("POST", `/v1/orders/${f.orderX}/cancel`, f.x);
    assert.deepEqual(cancel.json(), { status: "CANCELLED" });
    assert.equal(await reserved(f.variantA), before - 2);
    assert.equal(
      (await call("POST", `/v1/orders/${f.orderX}/cancel`, f.x)).statusCode,
      409,
    );
    const view = (await call("GET", `/v1/orders/${f.orderX}`, f.x)).json();
    assert.deepEqual(
      [view.status, ...view.sellers.map((s: { status: string }) => s.status)],
      ["CANCELLED", "CANCELLED", "CANCELLED"],
    );
  });

  test("an order left unpaid past its window expires and gives its stock back", async () => {
    const buyer = await user();
    const token = await session(buyer.id);
    await setLine(token, f.variantA, 1);
    const order = (
      await place(token, {
        idempotencyKey: key(),
        deliveries: [{ storeSlug: f.storeA.slug, method: "PICKUP" }],
        expectedTotalMinor: "12500",
      })
    ).json();
    const held = await reserved(f.variantA);
    await db.order.update({
      where: { id: order.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    assert.ok((await expireUnpaidOrders(db)) >= 1);
    assert.equal(
      (await call("GET", `/v1/orders/${order.id}`, token)).json().status,
      "EXPIRED",
    );
    assert.equal(await reserved(f.variantA), held - 1);
  });
});

describe("delivery settings", () => {
  test("only owners and managers set them, with exact amounts and versioning", async () => {
    const url = `/v1/stores/${f.storeA.id}/fulfilment`;
    const body = {
      deliveryFeeMinor: "2000",
      pickupEnabled: true,
      expectedVersion: 0,
    };
    assert.equal((await call("POST", url, f.catalogA, body)).statusCode, 403);
    assert.equal(
      (
        await call("POST", url, f.sellerA, {
          ...body,
          deliveryFeeMinor: "20.5",
        })
      ).statusCode,
      400,
    );
    assert.equal((await call("POST", url, f.sellerA, body)).statusCode, 200);
    assert.equal((await call("POST", url, f.sellerA, body)).statusCode, 409);
    const free = await call("POST", url, f.sellerA, {
      ...body,
      deliveryFeeMinor: "0",
      expectedVersion: 1,
    });
    assert.equal(free.statusCode, 200);
    const stored = await db.store.findUniqueOrThrow({
      where: { id: f.storeA.id },
    });
    assert.equal(stored.deliveryFeeMinor, 0n);
  });
});
