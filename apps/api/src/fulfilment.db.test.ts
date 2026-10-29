import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  asRuntime,
  createDatabase,
  enterTenant,
  issueSessionToken,
} from "@duoshop/database";
import {
  MOCK_SIGNATURE_HEADER,
  mockEventBody,
  providersFromEnv,
  signMockBody,
} from "@duoshop/payments";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

const secret = randomUUID() + randomUUID();
const db = createDatabase({ max: 6 });
const webOrigin = "http://localhost:3000";
const app = await createApp({
  db,
  webOrigin,
  providers: providersFromEnv({
    PAYMENTS_MOCK_ENABLED: "true",
    PAYMENTS_MOCK_SECRET: secret,
  }),
});
const code = `TEST_FUL_${randomUUID().slice(0, 6).toUpperCase().replaceAll("-", "")}`;
const ids = { tenant: "", users: [] as string[], method: "" };
const f = {
  storeId: "",
  slug: "",
  variant: "",
  owner: { id: "", token: "" },
  packer: { id: "", token: "" },
  catalog: { id: "", token: "" },
  buyer: { id: "", token: "" },
  stranger: { id: "", token: "" },
  address: "",
  home: { orderId: "", sellerOrderId: "" },
  pickup: { orderId: "", sellerOrderId: "" },
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

// Commande payée par un vrai webhook signé (chemin B06 complet).
async function paidOrder(method: "HOME_DELIVERY" | "PICKUP") {
  await call("POST", "/v1/cart/items", f.buyer.token, {
    variantId: f.variant,
    quantity: 1,
  });
  const placed = await call("POST", "/v1/orders", f.buyer.token, {
    idempotencyKey: randomUUID().replaceAll("-", ""),
    deliveries: [{ storeSlug: f.slug, method }],
    ...(method === "HOME_DELIVERY" ? { addressId: f.address } : {}),
    expectedTotalMinor: method === "HOME_DELIVERY" ? "11000" : "10000",
  });
  assert.equal(placed.statusCode, 201, placed.body);
  const orderId = placed.json().id as string;
  const started = await call(
    "POST",
    `/v1/orders/${orderId}/payments`,
    f.buyer.token,
    {
      methodCode: code,
      idempotencyKey: randomUUID().replaceAll("-", ""),
      payerPhone: "677 11 22 33",
    },
  );
  const payment = await db.payment.findUniqueOrThrow({
    where: { id: started.json().id },
  });
  const body = mockEventBody({
    paymentId: payment.id,
    providerReference: payment.providerReference ?? "",
    status: "SUCCEEDED",
    amountMinor: payment.amountMinor,
    currency: "XAF",
  });
  const hook = await app.inject({
    method: "POST",
    url: "/v1/payments/webhooks/mock",
    headers: {
      "content-type": "application/json",
      [MOCK_SIGNATURE_HEADER]: signMockBody(secret, body),
    },
    payload: body,
  });
  assert.equal(hook.json().outcome, "APPLIED");
  const so = await db.sellerOrder.findFirstOrThrow({ where: { orderId } });
  return { orderId, sellerOrderId: so.id };
}
const advance = (
  token: string,
  sellerOrderId: string,
  body: { to: string; note?: string; code?: string },
  version?: number,
) =>
  (async () => {
    const current =
      version ??
      (await db.sellerOrder.findUniqueOrThrow({ where: { id: sellerOrderId } }))
        .fulfilmentVersion;
    return call(
      "POST",
      `/v1/stores/${f.storeId}/orders/${sellerOrderId}/fulfilment`,
      token,
      { ...body, expectedVersion: current },
    );
  })();
const handoverCode = async (orderId: string) =>
  (await call("GET", `/v1/orders/${orderId}`, f.buyer.token)).json().sellers[0]
    .handoverCode as string | null;

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-B07", status: "ACTIVE" },
  });
  ids.tenant = tenant.id;
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Atelier Awa",
      deliveryFeeMinor: 1000n,
      pickupEnabled: true,
      pickupInstructions: "Marché Mboppi",
    },
  });
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
  });
  const product = await db.product.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      title: "Sac raphia",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `F-${randomUUID().slice(0, 8)}`,
      label: "Moyen",
      priceMinor: 10000n,
      currency: "XAF",
    },
  });
  await db.stockLevel.create({
    data: {
      tenantId: tenant.id,
      variantId: variant.id,
      locationId: location.id,
      onHand: 20,
    },
  });
  const method = await db.paymentMethod.create({
    data: {
      code,
      kind: "MOBILE_MONEY",
      operator: "MTN",
      provider: "mock",
      countryCode: "CM",
      currency: "XAF",
      labelFr: "MTN",
      labelEn: "MTN",
      enabled: true,
    },
  });
  ids.method = method.id;
  Object.assign(f, {
    storeId: store.id,
    slug: store.slug,
    variant: variant.id,
    owner: await user(),
    packer: await user(),
    catalog: await user(),
    buyer: await user(),
    stranger: await user(),
  });
  for (const [member, role] of [
    [f.owner, "OWNER"],
    [f.packer, "FULFILLMENT"],
    [f.catalog, "CATALOG"],
  ] as const)
    await db.storeMember.create({
      data: { tenantId: tenant.id, storeId: store.id, userId: member.id, role },
    });
  f.address = (
    await call("POST", "/v1/addresses", f.buyer.token, {
      label: "Maison",
      recipientName: "Awa Ngono",
      phone: "699 12 34 56",
      city: "Douala",
      district: "Bonamoussadi",
      landmark: "Derrière la station Total",
    })
  ).json().id;
  f.home = await paidOrder("HOME_DELIVERY");
  f.pickup = await paidOrder("PICKUP");
});

after(async () => {
  await app.close();
  const tenantId = ids.tenant;
  const userId = { in: ids.users };
  const sellerOrders = await db.sellerOrder.findMany({
    where: { tenantId },
    select: { id: true },
  });
  // Écritures comptables créées au paiement (B08), sans clé étrangère vers leur source.
  const ledgerSources = [
    ...(await db.sellerOrder.findMany({
      where: { tenantId: tenantId },
      select: { id: true },
    })),
    ...(await db.payment.findMany({
      where: { buyerId: userId },
      select: { id: true },
    })),
  ].map((x) => x.id);
  await db.ledgerEntry.deleteMany({
    where: { journal: { sourceId: { in: ledgerSources } } },
  });
  await db.ledgerJournal.deleteMany({
    where: { sourceId: { in: ledgerSources } },
  });
  await db.notification.deleteMany({ where: { userId } });
  await db.handoverCode.deleteMany({
    where: { sellerOrderId: { in: sellerOrders.map((s) => s.id) } },
  });
  await db.fulfilmentEvent.deleteMany({ where: { tenantId } });
  await db.outboxEvent.deleteMany({ where: { tenantId } });
  const payments = await db.payment.findMany({
    where: { buyerId: userId },
    select: { id: true },
  });
  await db.providerEvent.deleteMany({
    where: { paymentId: { in: payments.map((p) => p.id) } },
  });
  await db.payment.deleteMany({ where: { buyerId: userId } });
  await db.paymentMethod.delete({ where: { id: ids.method } });
  await db.stockMovement.deleteMany({ where: { tenantId } });
  await db.orderItem.deleteMany({ where: { tenantId } });
  await db.sellerOrder.deleteMany({ where: { tenantId } });
  await db.order.deleteMany({ where: { buyerId: userId } });
  await db.address.deleteMany({ where: { userId } });
  await db.cartItem.deleteMany({ where: { cart: { userId } } });
  await db.cart.deleteMany({ where: { userId } });
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.delete({ where: { id: tenantId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("after payment", () => {
  test("the order is to prepare, with a code only the buyer can read", async () => {
    const so = await db.sellerOrder.findUniqueOrThrow({
      where: { id: f.home.sellerOrderId },
    });
    assert.equal(so.fulfilmentStatus, "TO_PREPARE");
    const buyerCode = await handoverCode(f.home.orderId);
    assert.match(buyerCode ?? "", /^[0-9]{6}$/);
    // Le vendeur, dans son tenant, ne lit ni la table des codes ni le code via l'API.
    const seen = await asRuntime(db, { userId: f.owner.id }, async (tx) => {
      await enterTenant(tx, ids.tenant);
      return tx.handoverCode.count();
    });
    assert.equal(seen, 0);
    const sellerView = await call(
      "GET",
      `/v1/stores/${f.storeId}/orders`,
      f.owner.token,
    );
    for (const o of sellerView.json().orders) {
      assert.equal(o.handoverCode, null);
      assert.equal(o.fulfilmentStatus, "TO_PREPARE");
    }
  });

  test("buyer and fulfilment team are notified; catalog staff is not", async () => {
    const kinds = async (userId: string) =>
      (await db.notification.findMany({ where: { userId } })).map(
        (n) => n.kind,
      );
    assert.equal(
      (await kinds(f.buyer.id)).filter((k) => k === "order_paid").length,
      2,
    );
    assert.equal(
      (await kinds(f.owner.id)).filter((k) => k === "seller_order_paid").length,
      2,
    );
    assert.equal(
      (await kinds(f.packer.id)).filter((k) => k === "seller_order_paid")
        .length,
      2,
    );
    assert.deepEqual(await kinds(f.catalog.id), []);
    assert.ok(
      (await db.outboxEvent.count({
        where: { tenantId: ids.tenant, kind: "fulfilment.order_paid" },
      })) >= 2,
    );
  });
});

describe("advancing a seller order", () => {
  test("requires the fulfilment permission, the right order and the current version", async () => {
    assert.equal(
      (await advance(f.catalog.token, f.home.sellerOrderId, { to: "READY" }))
        .statusCode,
      403,
    );
    assert.equal(
      (await advance(f.stranger.token, f.home.sellerOrderId, { to: "READY" }))
        .statusCode,
      404,
    );
    const skip = await advance(f.packer.token, f.home.sellerOrderId, {
      to: "DELIVERED",
      code: "000000",
    });
    assert.equal(skip.json().error, "invalid_transition");
    const stale = await advance(
      f.packer.token,
      f.home.sellerOrderId,
      { to: "READY" },
      99,
    );
    assert.equal(stale.json().error, "stale_version");
  });

  test("home delivery: ready, out, failed attempt with a reason, out again, delivered with the code", async () => {
    const id = f.home.sellerOrderId;
    for (const to of ["READY", "OUT_FOR_DELIVERY"])
      assert.equal(
        (await advance(f.packer.token, id, { to })).statusCode,
        200,
        to,
      );
    assert.equal(
      (await advance(f.packer.token, id, { to: "DELIVERY_FAILED" })).json()
        .error,
      "note_required",
    );
    assert.equal(
      (
        await advance(f.packer.token, id, {
          to: "DELIVERY_FAILED",
          note: "Client absent, téléphone éteint",
        })
      ).statusCode,
      200,
    );
    assert.equal(
      (await advance(f.packer.token, id, { to: "OUT_FOR_DELIVERY" }))
        .statusCode,
      200,
    );
    assert.equal(
      (await advance(f.packer.token, id, { to: "DELIVERED" })).json().error,
      "code_required",
    );
    const real = (await handoverCode(f.home.orderId)) ?? "";
    const wrong = real === "123456" ? "654321" : "123456";
    assert.equal(
      (
        await advance(f.packer.token, id, { to: "DELIVERED", code: wrong })
      ).json().error,
      "code_invalid",
    );
    assert.equal(
      (await advance(f.packer.token, id, { to: "DELIVERED", code: real }))
        .statusCode,
      200,
    );
    const view = (
      await call("GET", `/v1/orders/${f.home.orderId}`, f.buyer.token)
    ).json().sellers[0];
    assert.equal(view.fulfilmentStatus, "DELIVERED");
    assert.ok(view.deliveredAt);
    assert.equal(view.handoverCode, null);
    assert.deepEqual(
      view.events.map((e: { status: string }) => e.status),
      [
        "TO_PREPARE",
        "READY",
        "OUT_FOR_DELIVERY",
        "DELIVERY_FAILED",
        "OUT_FOR_DELIVERY",
        "DELIVERED",
      ],
    );
    assert.equal(view.events[3].note, "Client absent, téléphone éteint");
    assert.equal(
      (await advance(f.packer.token, id, { to: "OUT_FOR_DELIVERY" })).json()
        .error,
      "invalid_transition",
    );
  });

  test("pickup: five wrong codes lock the handover, even for the right code", async () => {
    const id = f.pickup.sellerOrderId;
    assert.equal(
      (await advance(f.owner.token, id, { to: "READY" })).statusCode,
      200,
    );
    const real = (await handoverCode(f.pickup.orderId)) ?? "";
    const wrong = real === "111111" ? "222222" : "111111";
    const outcomes: string[] = [];
    for (let i = 0; i < 5; i++)
      outcomes.push(
        (
          await advance(f.owner.token, id, { to: "DELIVERED", code: wrong })
        ).json().error,
      );
    assert.deepEqual(outcomes, [
      "code_invalid",
      "code_invalid",
      "code_invalid",
      "code_invalid",
      "code_locked",
    ]);
    assert.equal(
      (await advance(f.owner.token, id, { to: "DELIVERED", code: real })).json()
        .error,
      "code_locked",
    );
    const sellerView = (
      await call("GET", `/v1/stores/${f.storeId}/orders`, f.owner.token)
    ).json().orders;
    assert.equal(
      sellerView.find((o: { id: string }) => o.id === id).handoverLocked,
      true,
    );
  });
});

describe("notifications", () => {
  test("each user reads and clears only their own", async () => {
    const mine = await call("GET", "/v1/notifications", f.buyer.token);
    assert.ok(mine.json().unread >= 6);
    assert.ok(
      mine
        .json()
        .notifications.some(
          (n: { kind: string }) => n.kind === "fulfilment_delivered",
        ),
    );
    assert.equal(
      (await call("GET", "/v1/notifications", f.stranger.token)).json().unread,
      0,
    );
    await call("POST", "/v1/notifications/read", f.buyer.token);
    assert.equal(
      (await call("GET", "/v1/notifications", f.buyer.token)).json().unread,
      0,
    );
    assert.ok(
      (await call("GET", "/v1/notifications", f.owner.token)).json().unread >=
        2,
    );
  });
});
