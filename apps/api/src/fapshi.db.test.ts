import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  applyPaymentEvent,
  createDatabase,
  issueSessionToken,
  pendingProviderPayments,
} from "@duoshop/database";
import { FapshiProvider, reconcilePayments } from "@duoshop/payments";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

// Chemin complet API + base + rapprochement du worker avec l'adaptateur Fapshi, l'API Fapshi
// étant simulée côté réseau (aucun appel réel). Prouve l'intégration, pas le comportement réel.
const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const fapshiState = {
  status: "CREATED",
  initiated: [] as Record<string, unknown>[],
  checks: 0,
};
const transId = `T${randomUUID().slice(0, 8)}`;
let externalId = "";
const http = (async (url: string | URL | Request, init?: RequestInit) => {
  const path = new URL(String(url)).pathname;
  if (path === "/initiate-pay") {
    const body = JSON.parse(String(init?.body));
    fapshiState.initiated.push(body);
    externalId = body.externalId;
    return Response.json({
      message: "Request successful",
      link: `https://checkout.fapshi.com/link/${transId}`,
      transId,
    });
  }
  if (path === `/payment-status/${transId}`) {
    fapshiState.checks++;
    return Response.json({
      transId,
      status: fapshiState.status,
      transType: "Collection",
      amount: 12500,
      revenue: 12125,
      externalId,
    });
  }
  return Response.json({ message: "not found" }, { status: 404 });
}) as typeof fetch;
const fapshi = new FapshiProvider(
  { apiUser: "u", apiKey: "k", webhookSecret: "wh-secret", mode: "SANDBOX" },
  http,
);
const providers = new Map([["fapshi", fapshi]]);
const app = await createApp({ db, webOrigin, providers });
const code = `TEST_FP_${randomUUID().slice(0, 6).toUpperCase().replaceAll("-", "")}`;
const ids = { tenant: "", users: [] as string[], method: "" };
let buyer = "";
let orderId = "";
let paymentId = "";

const notify = (secret?: string) =>
  app.inject({
    method: "POST",
    url: "/v1/payments/webhooks/fapshi",
    headers: {
      "content-type": "application/json",
      ...(secret ? { "x-wh-secret": secret } : {}),
    },
    payload: JSON.stringify({ transId, status: "SUCCESSFUL", amount: 1 }),
  });
const reconcile = (includeOld = false) =>
  reconcilePayments(
    providers,
    {
      pending: (key, old) => pendingProviderPayments(db, key, old),
      apply: (key, event) => applyPaymentEvent(db, key, event),
    },
    includeOld,
  );

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-FAPSHI", status: "ACTIVE" },
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
      sku: `FP-${randomUUID().slice(0, 8)}`,
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
      provider: "fapshi",
      countryCode: "CM",
      currency: "XAF",
      labelFr: "MTN via Fapshi",
      labelEn: "MTN via Fapshi",
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
    where: { provider: "fapshi", paymentId: null },
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

describe("Fapshi through the API (simulated network)", () => {
  test("the buyer is sent to the Fapshi payment link, created once with our payment id", async () => {
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
      url: `https://checkout.fapshi.com/link/${transId}`,
    });
    assert.equal(fapshiState.initiated.length, 1);
    assert.equal(fapshiState.initiated[0]?.externalId, paymentId);
    assert.equal(fapshiState.initiated[0]?.amount, 12500);
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    assert.equal(payment.providerReference, transId);
  });

  test("a webhook without the shared secret is refused before any call to Fapshi", async () => {
    assert.equal((await notify()).statusCode, 401);
    assert.equal((await notify("guess")).statusCode, 401);
    assert.equal(fapshiState.checks, 0);
  });

  test("a forged success is ignored while Fapshi still reports the payment as pending", async () => {
    fapshiState.status = "PENDING";
    const response = await notify("wh-secret");
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().outcome, "IGNORED");
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(order.status, "AWAITING_PAYMENT");
  });

  test("a late payment on a locally closed attempt, with its webhook lost, is caught up once", async () => {
    fapshiState.status = "SUCCESSFUL";
    // Paiement trop récent : pas encore relu (laisse le temps au webhook d'arriver).
    assert.deepEqual(await reconcile(), { checked: 0, applied: 0, failed: 0 });
    // Tentative close localement (délai de 10 minutes) alors que le lien Fapshi reste payable.
    await db.payment.update({
      where: { id: paymentId },
      data: {
        createdAt: new Date(Date.now() - 12 * 60_000),
        status: "EXPIRED",
        failureCode: "attempt_timeout",
      },
    });
    assert.deepEqual(await reconcile(), { checked: 1, applied: 1, failed: 0 });
    const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
    assert.equal(order.status, "PAID");
    // Plus rien à relire, et le webhook arrivé ensuite ne double rien.
    assert.deepEqual(await reconcile(true), {
      checked: 0,
      applied: 0,
      failed: 0,
    });
    const late = await notify("wh-secret");
    assert.equal(late.json().outcome, "DUPLICATE");
    // Un seul succès appliqué pour ce paiement, quel que soit le canal.
    assert.equal(
      await db.providerEvent.count({
        where: { paymentId, outcome: "APPLIED" },
      }),
      1,
    );
  });
});
