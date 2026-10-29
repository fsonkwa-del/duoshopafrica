import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  createDatabase,
  expireUnpaidOrders,
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
const suffix = randomUUID().slice(0, 6).toUpperCase().replaceAll("-", "");
const codes = {
  mtn: `TEST_MTN_${suffix}`,
  orange: `TEST_OM_${suffix}`,
  card: `TEST_CARD_${suffix}`,
};
const ids = {
  tenants: [] as string[],
  users: [] as string[],
  methods: [] as string[],
};
const f = {
  storeId: "",
  slug: "",
  variant: "",
  seller: "",
  x: "",
  y: "",
  addressX: "",
  admin: "",
  adminNoMfa: "",
  support: "",
  stranger: "",
  paidOrder: "",
};

async function user(
  options: { mfa?: boolean; platform?: "ADMIN" | "SUPPORT" } = {},
) {
  const created = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(created.id);
  if (options.platform)
    await db.platformMember.create({
      data: { userId: created.id, role: options.platform },
    });
  const { token, tokenHash } = issueSessionToken();
  await db.session.create({
    data: {
      userId: created.id,
      tokenHash,
      mfa: options.mfa ?? false,
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
const key = () => randomUUID().replaceAll("-", "");
const webhook = (body: string, signature?: string, provider = "mock") =>
  app.inject({
    method: "POST",
    url: `/v1/payments/webhooks/${provider}`,
    headers: {
      "content-type": "application/json",
      ...(signature ? { [MOCK_SIGNATURE_HEADER]: signature } : {}),
    },
    payload: body,
  });
const signed = (body: string, at?: Date) =>
  webhook(body, signMockBody(secret, body, at));
const level = () =>
  db.stockLevel.findFirstOrThrow({ where: { variantId: f.variant } });

// Commande de `quantity` pagnes (12 500) livrés à domicile (1 500), pour l'acheteur X.
async function order(quantity: number) {
  await call("POST", "/v1/cart/items", f.x, { variantId: f.variant, quantity });
  const placed = await call("POST", "/v1/orders", f.x, {
    idempotencyKey: key(),
    deliveries: [{ storeSlug: f.slug, method: "HOME_DELIVERY" }],
    addressId: f.addressX,
    expectedTotalMinor: String(12500 * quantity + 1500),
  });
  assert.equal(placed.statusCode, 201, placed.body);
  return placed.json() as { id: string; total: { amountMinor: string } };
}
const pay = (orderId: string, body: object, token = f.x) =>
  call("POST", `/v1/orders/${orderId}/payments`, token, body);
const method = (code: string, overrides: object = {}) => ({
  code,
  kind: "MOBILE_MONEY",
  operator: "MTN",
  provider: "mock",
  countryCode: "CM",
  currency: "XAF",
  labelFr: "MTN Mobile Money (test)",
  labelEn: "MTN Mobile Money (test)",
  phonePrefixes: ["+23767", "+23768"],
  minAmountMinor: "100",
  maxAmountMinor: "1000000",
  displayOrder: 10,
  enabled: true,
  ...overrides,
});

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-B06", status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Atelier Awa",
      deliveryFeeMinor: 1500n,
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
      sku: `P-${randomUUID().slice(0, 8)}`,
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
      onHand: 10,
    },
  });
  const seller = await user();
  await db.storeMember.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      userId: seller.id,
      role: "OWNER",
    },
  });
  Object.assign(f, {
    storeId: store.id,
    slug: store.slug,
    variant: variant.id,
    seller: seller.token,
    x: (await user()).token,
    y: (await user()).token,
    admin: (await user({ mfa: true, platform: "ADMIN" })).token,
    adminNoMfa: (await user({ platform: "ADMIN" })).token,
    support: (await user({ mfa: true, platform: "SUPPORT" })).token,
    stranger: (await user({ mfa: true })).token,
  });
  const address = await call("POST", "/v1/addresses", f.x, {
    label: "Maison",
    recipientName: "Awa Ngono",
    phone: "699 12 34 56",
    city: "Douala",
    district: "Bonamoussadi",
    landmark: "Derrière la station Total, portail bleu",
  });
  f.addressX = address.json().id;
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  const payments = await db.payment.findMany({
    where: { buyerId: userId },
    select: { id: true },
  });
  await db.providerEvent.deleteMany({
    where: { paymentId: { in: payments.map((p) => p.id) } },
  });
  await db.providerEvent.deleteMany({
    where: { eventId: { startsWith: `test_${suffix}` } },
  });
  await db.payment.deleteMany({ where: { buyerId: userId } });
  await db.configAudit.deleteMany({ where: { entityId: { in: ids.methods } } });
  await db.paymentMethod.deleteMany({ where: { id: { in: ids.methods } } });
  // Écritures comptables créées au paiement (B08), sans clé étrangère vers leur source.
  const ledgerSources = [
    ...(await db.sellerOrder.findMany({
      where: { tenantId: tenantId },
      select: { id: true },
    })),
    // Paiements déjà supprimés plus haut : identifiants relevés en début de nettoyage.
    ...payments,
  ].map((x) => x.id);
  await db.ledgerEntry.deleteMany({
    where: { journal: { sourceId: { in: ledgerSources } } },
  });
  await db.ledgerJournal.deleteMany({
    where: { sourceId: { in: ledgerSources } },
  });
  // Jalons créés automatiquement au paiement (B07).
  await db.handoverCode.deleteMany({ where: { buyerId: userId } });
  await db.fulfilmentEvent.deleteMany({ where: { tenantId } });
  await db.notification.deleteMany({ where: { userId } });
  await db.outboxEvent.deleteMany({ where: { tenantId } });
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
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("payment methods configured per operator", () => {
  test("only an MFA-attested admin configures; support reads; others see nothing", async () => {
    const url = "/v1/admin/payment-methods";
    assert.equal((await call("GET", url, f.stranger)).statusCode, 404);
    assert.equal((await call("GET", url, f.support)).statusCode, 200);
    assert.equal(
      (await call("POST", url, f.support, method(codes.mtn))).statusCode,
      403,
    );
    const noMfa = await call("POST", url, f.adminNoMfa, method(codes.mtn));
    assert.equal(noMfa.statusCode, 403);
    assert.equal(noMfa.json().error, "mfa_required");
  });

  test("admin creates MTN, Orange and a card method; invalid input is refused", async () => {
    const url = "/v1/admin/payment-methods";
    for (const bad of [
      method(codes.mtn, { minAmountMinor: "500", maxAmountMinor: "100" }),
      method(codes.mtn, { phonePrefixes: ["67"] }),
      method(codes.mtn, { secret: "x" }),
      method("lowercase"),
    ])
      assert.equal(
        (await call("POST", url, f.admin, bad)).statusCode,
        400,
        JSON.stringify(bad),
      );
    const mtn = await call("POST", url, f.admin, method(codes.mtn));
    assert.equal(mtn.statusCode, 201, mtn.body);
    assert.equal(mtn.json().providerMode, "MOCK");
    const orange = await call(
      "POST",
      url,
      f.admin,
      method(codes.orange, {
        operator: "ORANGE",
        labelFr: "Orange Money (test)",
        labelEn: "Orange Money (test)",
        phonePrefixes: ["+23769"],
        displayOrder: 20,
      }),
    );
    // Carte chez un prestataire sans adaptateur dans cet environnement : configurable,
    // jamais proposée aux acheteurs.
    const card = await call(
      "POST",
      url,
      f.admin,
      method(codes.card, {
        kind: "CARD",
        operator: "",
        provider: "cinetpay",
        phonePrefixes: [],
      }),
    );
    assert.equal(card.json().providerMode, null);
    assert.equal(card.json().operator, null);
    ids.methods.push(mtn.json().id, orange.json().id, card.json().id);
    assert.equal(
      (await call("POST", url, f.admin, method(codes.mtn))).json().error,
      "code_taken",
    );
    const audit = await db.configAudit.count({
      where: { entityId: { in: ids.methods }, action: "create" },
    });
    assert.equal(audit, 3);
  });

  test("updates are versioned and audited (enable/disable)", async () => {
    const mtnId = ids.methods[0] ?? "";
    const url = `/v1/admin/payment-methods/${mtnId}`;
    const { code: _c, ...fields } = method(codes.mtn);
    const disabled = await call("POST", url, f.admin, {
      ...fields,
      enabled: false,
      expectedVersion: 0,
    });
    assert.equal(disabled.statusCode, 200, disabled.body);
    assert.equal(disabled.json().version, 1);
    const stale = await call("POST", url, f.admin, {
      ...fields,
      expectedVersion: 0,
    });
    assert.equal(stale.json().error, "version_conflict");
    const enabled = await call("POST", url, f.admin, {
      ...fields,
      expectedVersion: 1,
    });
    assert.equal(enabled.json().enabled, true);
    const actions = await db.configAudit.findMany({
      where: { entityId: mtnId },
      orderBy: { createdAt: "asc" },
      select: { action: true },
    });
    assert.deepEqual(
      actions.map((a) => a.action),
      ["create", "disable", "enable"],
    );
  });
});

describe("paying an order with a configured method", () => {
  test("buyer sees only enabled methods whose adapter exists, in the order's currency", async () => {
    const o = await order(2);
    f.paidOrder = o.id;
    const listed = await call("GET", `/v1/orders/${o.id}/payment-methods`, f.x);
    const mine = (listed.json().methods as { code: string; mode: string }[])
      .filter((m) => Object.values(codes).includes(m.code))
      .map((m) => [m.code, m.mode]);
    assert.deepEqual(mine, [
      [codes.mtn, "MOCK"],
      [codes.orange, "MOCK"],
    ]);
    assert.equal(
      (await call("GET", `/v1/orders/${o.id}/payment-methods`, f.y)).statusCode,
      404,
    );
  });

  test("phone must be valid and belong to the method's operator", async () => {
    const id = f.paidOrder;
    const bad = await pay(id, {
      methodCode: codes.mtn,
      idempotencyKey: key(),
      payerPhone: "12",
    });
    assert.equal(bad.json().error, "invalid_phone");
    const orangeNumber = await pay(id, {
      methodCode: codes.mtn,
      idempotencyKey: key(),
      payerPhone: "699 00 00 00",
    });
    assert.equal(orangeNumber.json().error, "phone_operator_mismatch");
    const noAdapter = await pay(id, {
      methodCode: codes.card,
      idempotencyKey: key(),
    });
    assert.equal(noAdapter.json().error, "method_unavailable");
    assert.equal(await db.payment.count({ where: { orderId: id } }), 0);
  });

  test("one attempt at a time, idempotent, and it blocks cancellation", async () => {
    const id = f.paidOrder;
    const before = await db.order.findUniqueOrThrow({ where: { id } });
    const k = key();
    const started = await pay(id, {
      methodCode: codes.mtn,
      idempotencyKey: k,
      payerPhone: "677 11 22 33",
    });
    assert.equal(started.statusCode, 201, started.body);
    assert.equal(started.json().status, "PENDING");
    assert.equal(started.json().mode, "MOCK");
    assert.deepEqual(started.json().nextAction, { type: "test_simulator" });
    assert.equal(started.json().payerPhoneHint, "••33");
    const replay = await pay(id, {
      methodCode: codes.mtn,
      idempotencyKey: k,
      payerPhone: "677112233",
    });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().id, started.json().id);
    const otherPhone = await pay(id, {
      methodCode: codes.mtn,
      idempotencyKey: k,
      payerPhone: "677 99 99 99",
    });
    assert.equal(otherPhone.json().error, "idempotency_conflict");
    const second = await pay(id, {
      methodCode: codes.orange,
      idempotencyKey: key(),
      payerPhone: "699 00 00 00",
    });
    assert.equal(second.json().error, "payment_in_progress");
    const cancel = await call("POST", `/v1/orders/${id}/cancel`, f.x);
    assert.equal(cancel.json().error, "payment_in_progress");
    const after = await db.order.findUniqueOrThrow({ where: { id } });
    assert.ok(after.expiresAt.getTime() >= before.expiresAt.getTime());
    assert.ok(after.expiresAt.getTime() > Date.now() + 9 * 60_000);
    // Personne ne peut déclarer un paiement réussi depuis le navigateur : seul un webhook signé.
    assert.equal(after.status, "AWAITING_PAYMENT");
  });

  test("unsigned, tampered, stale or unknown-provider webhooks change nothing", async () => {
    const payment = await db.payment.findFirstOrThrow({
      where: { orderId: f.paidOrder },
    });
    const body = mockEventBody({
      eventId: `test_${suffix}_forged`,
      paymentId: payment.id,
      providerReference: payment.providerReference ?? "",
      status: "SUCCEEDED",
      amountMinor: payment.amountMinor,
      currency: "XAF",
    });
    assert.equal((await webhook(body)).statusCode, 401);
    assert.equal(
      (await webhook(body, signMockBody("y".repeat(40), body))).statusCode,
      401,
    );
    assert.equal(
      (await signed(body, new Date(Date.now() - 10 * 60_000))).statusCode,
      401,
    );
    assert.equal(
      (await webhook(body, signMockBody(secret, body), "cinetpay")).statusCode,
      404,
    );
    assert.equal(
      await db.providerEvent.count({ where: { paymentId: payment.id } }),
      0,
    );
    const order = await db.order.findUniqueOrThrow({
      where: { id: f.paidOrder },
    });
    assert.equal(order.status, "AWAITING_PAYMENT");
  });

  test("a verified success pays the order once, sells the stock and releases the delivery contact", async () => {
    const payment = await db.payment.findFirstOrThrow({
      where: { orderId: f.paidOrder },
    });
    const stock = await level();
    const body = mockEventBody({
      eventId: `test_${suffix}_ok`,
      paymentId: payment.id,
      providerReference: payment.providerReference ?? "",
      status: "SUCCEEDED",
      amountMinor: payment.amountMinor,
      currency: "XAF",
    });
    // Le prestataire renvoie le même événement deux fois en parallèle.
    const [a, b] = await Promise.all([signed(body), signed(body)]);
    assert.deepEqual([a.json().outcome, b.json().outcome].sort(), [
      "APPLIED",
      "DUPLICATE",
    ]);
    const order = await db.order.findUniqueOrThrow({
      where: { id: f.paidOrder },
      include: { sellerOrders: true },
    });
    assert.equal(order.status, "PAID");
    assert.ok(order.paidAt);
    assert.deepEqual(
      order.sellerOrders.map((so) => so.status),
      ["PAID"],
    );
    const now = await level();
    assert.equal(now.onHand, stock.onHand - 2);
    assert.equal(now.reserved, stock.reserved - 2);
    const sale = await db.stockMovement.findMany({
      where: { variantId: f.variant, reason: "SALE" },
    });
    assert.deepEqual(
      sale.map((m) => m.delta),
      [-2],
    );
    assert.equal(
      await db.stockReservation.count({
        where: {
          reference: { startsWith: `order:${f.paidOrder}:` },
          status: "CONSUMED",
        },
      }),
      1,
    );
    // Rejeu tardif exact : aucun effet supplémentaire.
    assert.equal((await signed(body)).json().outcome, "DUPLICATE");
    assert.equal((await level()).onHand, now.onHand);
    // Même identifiant, contenu différent : quarantaine, rien n'est appliqué.
    const altered = mockEventBody({
      eventId: `test_${suffix}_ok`,
      paymentId: payment.id,
      providerReference: payment.providerReference ?? "",
      status: "FAILED",
      amountMinor: payment.amountMinor,
      currency: "XAF",
    });
    assert.equal((await signed(altered)).json().outcome, "QUARANTINED");
    const settled = await db.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    assert.equal(settled.status, "SUCCEEDED");

    const buyerView = await call("GET", `/v1/orders/${f.paidOrder}`, f.x);
    assert.equal(buyerView.json().status, "PAID");
    assert.equal(buyerView.json().payments[0].status, "SUCCEEDED");
    assert.equal(buyerView.json().payments[0].nextAction, null);
    const sellerView = await call(
      "GET",
      `/v1/stores/${f.storeId}/orders`,
      f.seller,
    );
    const sold = sellerView
      .json()
      .orders.find((o: { orderId: string }) => o.orderId === f.paidOrder);
    assert.equal(sold.status, "PAID");
    assert.equal(sold.deliveryContact.phone, "+237699123456");
    assert.equal(
      sold.deliveryContact.landmark,
      "Derrière la station Total, portail bleu",
    );
  });

  test("a declined attempt leaves the order payable; a new attempt can succeed (simulator)", async () => {
    const o = await order(1);
    const first = await pay(o.id, {
      methodCode: codes.orange,
      idempotencyKey: key(),
      payerPhone: "699 00 00 00",
    });
    // Le simulateur n'agit que sur ses propres paiements.
    assert.equal(
      (
        await call("POST", `/v1/payments/${first.json().id}/simulate`, f.y, {
          outcome: "SUCCEEDED",
        })
      ).statusCode,
      404,
    );
    const declined = await call(
      "POST",
      `/v1/payments/${first.json().id}/simulate`,
      f.x,
      { outcome: "FAILED" },
    );
    assert.equal(declined.json().outcome, "APPLIED");
    let view = (await call("GET", `/v1/orders/${o.id}`, f.x)).json();
    assert.equal(view.status, "AWAITING_PAYMENT");
    assert.equal(view.payments[0].status, "FAILED");
    assert.equal(view.payments[0].failureCode, "declined_by_payer");
    const retry = await pay(o.id, {
      methodCode: codes.mtn,
      idempotencyKey: key(),
      payerPhone: "677 11 22 33",
    });
    assert.equal(retry.statusCode, 201);
    const ok = await call(
      "POST",
      `/v1/payments/${retry.json().id}/simulate`,
      f.x,
      { outcome: "SUCCEEDED" },
    );
    assert.equal(ok.json().outcome, "APPLIED");
    view = (await call("GET", `/v1/orders/${o.id}`, f.x)).json();
    assert.equal(view.status, "PAID");
    assert.deepEqual(
      view.payments.map((p: { status: string }) => p.status),
      ["SUCCEEDED", "FAILED"],
    );
  });

  test("a success after the order expired is recorded and flagged, never silently applied", async () => {
    const o = await order(1);
    const started = await pay(o.id, {
      methodCode: codes.mtn,
      idempotencyKey: key(),
      payerPhone: "677 11 22 33",
    });
    const stock = await level();
    await db.order.update({
      where: { id: o.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expireUnpaidOrders(db);
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: started.json().id },
    });
    assert.equal(payment.status, "EXPIRED");
    const late = mockEventBody({
      eventId: `test_${suffix}_late`,
      paymentId: payment.id,
      providerReference: payment.providerReference ?? "",
      status: "SUCCEEDED",
      amountMinor: payment.amountMinor,
      currency: "XAF",
    });
    assert.equal((await signed(late)).json().outcome, "APPLIED");
    const flagged = await db.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    assert.equal(flagged.status, "SUCCEEDED");
    assert.equal(flagged.attentionReason, "order_closed");
    assert.equal(
      (await db.order.findUniqueOrThrow({ where: { id: o.id } })).status,
      "EXPIRED",
    );
    const after = await level();
    assert.equal(after.onHand, stock.onHand);
    assert.equal(after.reserved, stock.reserved - 1);

    const attention = await call("GET", "/v1/admin/payments", f.support);
    assert.ok(
      attention
        .json()
        .payments.some(
          (p: { id: string; attentionReason: string }) =>
            p.id === payment.id && p.attentionReason === "order_closed",
        ),
    );
    assert.ok(
      attention
        .json()
        .events.some(
          (e: { eventId: string; outcome: string }) =>
            e.eventId === `test_${suffix}_ok` && e.outcome === "QUARANTINED",
        ),
    );
    assert.equal(
      (await call("GET", "/v1/admin/payments", f.stranger)).statusCode,
      404,
    );
  });

  test("a wrong amount is quarantined; an unknown payment is kept as orphan", async () => {
    const o = await order(1);
    const started = await pay(o.id, {
      methodCode: codes.mtn,
      idempotencyKey: key(),
      payerPhone: "677 11 22 33",
    });
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: started.json().id },
    });
    const cheap = mockEventBody({
      eventId: `test_${suffix}_cheap`,
      paymentId: payment.id,
      providerReference: payment.providerReference ?? "",
      status: "SUCCEEDED",
      amountMinor: 100n,
      currency: "XAF",
    });
    assert.equal((await signed(cheap)).json().outcome, "QUARANTINED");
    const still = await db.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    assert.equal(still.status, "PENDING");
    assert.equal(still.attentionReason, "amount_mismatch");
    assert.equal(
      (await db.order.findUniqueOrThrow({ where: { id: o.id } })).status,
      "AWAITING_PAYMENT",
    );
    const orphan = mockEventBody({
      eventId: `test_${suffix}_orphan`,
      paymentId: randomUUID(),
      providerReference: "mock_unknown",
      status: "SUCCEEDED",
      amountMinor: 1000n,
      currency: "XAF",
    });
    assert.equal((await signed(orphan)).json().outcome, "ORPHAN");
  });
});
