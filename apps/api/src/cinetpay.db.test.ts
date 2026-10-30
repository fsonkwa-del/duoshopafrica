import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import { CinetPayProvider } from "@duoshop/payments";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

// Chemin complet API + base avec l'adaptateur CinetPay, l'API CinetPay étant simulée côté
// réseau (aucun appel réel). Prouve l'intégration, pas le comportement réel de CinetPay.
const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const check = {
  status: "ACCEPTED",
  amount: "",
  calls: 0,
};
const http = (async (url: string | URL | Request, init?: RequestInit) => {
  const path = new URL(String(url)).pathname;
  const body = JSON.parse(String(init?.body));
  if (path === "/v2/payment")
    return Response.json({
      code: "201",
      data: {
        payment_url: `https://checkout.cinetpay.com/payment/${body.transaction_id}`,
      },
    });
  check.calls++;
  return Response.json({
    code: "00",
    data: { status: check.status, amount: check.amount, currency: "XAF" },
  });
}) as typeof fetch;
const app = await createApp({
  db,
  webOrigin,
  providers: new Map([
    [
      "cinetpay",
      new CinetPayProvider(
        { apiKey: "k", siteId: "105", mode: "SANDBOX" },
        http,
      ),
    ],
  ]),
});
const code = `TEST_CP_${randomUUID().slice(0, 6).toUpperCase().replaceAll("-", "")}`;
const ids = { tenant: "", users: [] as string[], method: "" };
let buyer = "";
let orderId = "";
let paymentId = "";

const notify = (transactionId: string, site = "105") =>
  app.inject({
    method: "POST",
    url: "/v1/payments/webhooks/cinetpay",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      cpm_trans_id: transactionId,
      cpm_site_id: site,
    }).toString(),
  });

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-CINETPAY", status: "ACTIVE" },
  });
  ids.tenant = tenant.id;
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Atelier",
      pickupEnabled: true,
    },
  });
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
  });
  const product = await db.product.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      title: "Pagne",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `CP-${randomUUID().slice(0, 8)}`,
      label: "6 yards",
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
  const method = await db.paymentMethod.create({
    data: {
      code,
      kind: "MOBILE_MONEY",
      operator: "MTN",
      provider: "cinetpay",
      countryCode: "CM",
      currency: "XAF",
      labelFr: "MTN via CinetPay",
      labelEn: "MTN via CinetPay",
      enabled: true,
    },
  });
  ids.method = method.id;
  const user = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(user.id);
  const { token, tokenHash } = issueSessionToken();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  buyer = token;
  const headers = {
    cookie: `${SESSION_COOKIE}=${buyer}`,
    origin: webOrigin,
  };
  await app.inject({
    method: "POST",
    url: "/v1/cart/items",
    headers,
    payload: { variantId: variant.id, quantity: 1 },
  });
  const placed = await app.inject({
    method: "POST",
    url: "/v1/orders",
    headers,
    payload: {
      idempotencyKey: randomUUID().replaceAll("-", ""),
      deliveries: [{ storeSlug: store.slug, method: "PICKUP" }],
      expectedTotalMinor: "12500",
    },
  });
  orderId = placed.json().id;
});

after(async () => {
  await app.close();
  const tenantId = ids.tenant;
  const userId = { in: ids.users };
  const sellerOrders = await db.sellerOrder.findMany({
    where: { tenantId },
    select: { id: true },
  });
  const payments = await db.payment.findMany({
    where: { buyerId: userId },
    select: { id: true },
  });
  const sources = [...sellerOrders, ...payments].map((x) => x.id);
  await db.ledgerEntry.deleteMany({
    where: { journal: { sourceId: { in: sources } } },
  });
  await db.ledgerJournal.deleteMany({ where: { sourceId: { in: sources } } });
  await db.handoverCode.deleteMany({ where: { buyerId: userId } });
  await db.fulfilmentEvent.deleteMany({ where: { tenantId } });
  await db.notification.deleteMany({ where: { userId } });
  await db.outboxEvent.deleteMany({ where: { tenantId } });
  await db.providerEvent.deleteMany({
    where: { paymentId: { in: payments.map((p) => p.id) } },
  });
  await db.providerEvent.deleteMany({
    where: { provider: "cinetpay", paymentId: null },
  });
  await db.payment.deleteMany({ where: { buyerId: userId } });
  await db.paymentMethod.delete({ where: { id: ids.method } });
  await db.stockMovement.deleteMany({ where: { tenantId } });
  await db.orderItem.deleteMany({ where: { tenantId } });
  await db.sellerOrder.deleteMany({ where: { tenantId } });
  await db.order.deleteMany({ where: { buyerId: userId } });
  await db.cartItem.deleteMany({ where: { cart: { userId } } });
  await db.cart.deleteMany({ where: { userId } });
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.delete({ where: { id: tenantId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("CinetPay through the API (simulated network)", () => {
  test("the buyer is sent to the hosted page; return only redirects to the order", async () => {
    const started = await app.inject({
      method: "POST",
      url: `/v1/orders/${orderId}/payments`,
      headers: { cookie: `${SESSION_COOKIE}=${buyer}`, origin: webOrigin },
      payload: {
        methodCode: code,
        idempotencyKey: randomUUID().replaceAll("-", ""),
        payerPhone: "677 11 22 33",
      },
    });
    assert.equal(started.statusCode, 201, started.body);
    paymentId = started.json().id;
    assert.equal(started.json().mode, "SANDBOX");
    assert.deepEqual(started.json().nextAction, {
      type: "redirect",
      url: `https://checkout.cinetpay.com/payment/${paymentId}`,
    });
    const back = await app.inject({
      method: "POST",
      url: `/v1/payments/return?order=${orderId}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "cpm_trans_id=whatever&status=ACCEPTED",
    });
    assert.equal(back.statusCode, 303);
    assert.equal(back.headers.location, `${webOrigin}/fr/orders/${orderId}`);
    // Le retour ne change rien : seul le webhook vérifié compte.
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(order.status, "AWAITING_PAYMENT");
  });

  test("a notification for another site is refused; forged body fields are ignored", async () => {
    assert.equal((await notify(paymentId, "999")).statusCode, 401);
    // Corps falsifié (« ACCEPTED », montant 1) : l'adaptateur relit le statut chez CinetPay,
    // qui répond encore « en attente » ; rien n'est appliqué.
    check.status = "PENDING";
    check.amount = "12500";
    const forged = await app.inject({
      method: "POST",
      url: "/v1/payments/webhooks/cinetpay",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        cpm_trans_id: paymentId,
        cpm_site_id: "105",
        cpm_amount: "1",
        status: "ACCEPTED",
      }).toString(),
    });
    assert.equal(forged.json().outcome, "IGNORED");
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(order.status, "AWAITING_PAYMENT");
  });

  test("an accepted status re-read from CinetPay pays the order once", async () => {
    check.status = "ACCEPTED";
    const first = await notify(paymentId);
    assert.equal(first.json().outcome, "APPLIED");
    // CinetPay renvoie la même notification : relue, même empreinte, aucun double effet.
    assert.equal((await notify(paymentId)).json().outcome, "DUPLICATE");
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(order.status, "PAID");
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    assert.equal(payment.status, "SUCCEEDED");
    assert.equal(payment.mode, "SANDBOX");
  });
});
