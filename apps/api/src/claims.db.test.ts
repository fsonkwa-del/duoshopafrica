import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
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
const methodCode = `TEST_CLM_${randomUUID().slice(0, 6).toUpperCase().replaceAll("-", "")}`;
const ids = {
  tenants: [] as string[],
  users: [] as string[],
  method: "",
  rule: "",
};
const f = {
  storeA: "",
  slugA: "",
  variantA: "",
  storeB: "",
  owner: "",
  packer: "",
  ownerB: "",
  buyer: "",
  buyer2: "",
  admin: "",
  support: "",
  address: "",
  main: { orderId: "", sellerOrderId: "", items: [] as string[] },
  claimId: "",
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
async function shop(name: string) {
  const tenant = await db.tenant.create({
    data: { name: `TEST-B09-${name}`, status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name,
      deliveryFeeMinor: 1000n,
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
      sku: `C-${randomUUID().slice(0, 8)}`,
      label: "6 yards",
      priceMinor: 10000n,
      currency: "XAF",
    },
  });
  await db.stockLevel.create({
    data: {
      tenantId: tenant.id,
      variantId: variant.id,
      locationId: location.id,
      onHand: 100,
    },
  });
  return { tenantId: tenant.id, store, variantId: variant.id };
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

// Commande de `quantity` pagnes payée (webhook signé) et, si demandé, remise contre le code.
async function order(quantity: number, deliver = true) {
  await call("POST", "/v1/cart/items", f.buyer, {
    variantId: f.variantA,
    quantity,
  });
  const placed = await call("POST", "/v1/orders", f.buyer, {
    idempotencyKey: key(),
    deliveries: [{ storeSlug: f.slugA, method: "HOME_DELIVERY" }],
    addressId: f.address,
    expectedTotalMinor: String(10000 * quantity + 1000),
  });
  assert.equal(placed.statusCode, 201, placed.body);
  const orderId = placed.json().id as string;
  const started = await call(
    "POST",
    `/v1/orders/${orderId}/payments`,
    f.buyer,
    {
      methodCode,
      idempotencyKey: key(),
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
  await app.inject({
    method: "POST",
    url: "/v1/payments/webhooks/mock",
    headers: {
      "content-type": "application/json",
      [MOCK_SIGNATURE_HEADER]: signMockBody(secret, body),
    },
    payload: body,
  });
  const so = await db.sellerOrder.findFirstOrThrow({
    where: { orderId },
    include: { items: true, handover: true },
  });
  if (deliver)
    for (const step of [
      { to: "READY" },
      { to: "OUT_FOR_DELIVERY" },
      { to: "DELIVERED", code: so.handover?.code },
    ]) {
      const current = await db.sellerOrder.findUniqueOrThrow({
        where: { id: so.id },
      });
      const res = await call(
        "POST",
        `/v1/stores/${f.storeA}/orders/${so.id}/fulfilment`,
        f.owner,
        { ...step, expectedVersion: current.fulfilmentVersion },
      );
      assert.equal(res.statusCode, 200, res.body);
    }
  return { orderId, sellerOrderId: so.id, items: so.items.map((i) => i.id) };
}
const claim = (
  o: { orderId: string; sellerOrderId: string; items: string[] },
  quantity: number,
  extra: object = {},
  token = f.buyer,
) =>
  call("POST", `/v1/orders/${o.orderId}/claims`, token, {
    sellerOrderId: o.sellerOrderId,
    reason: "DAMAGED",
    description: "Le tissu est déchiré sur toute la longueur.",
    items: [{ orderItemId: o.items[0], quantity }],
    idempotencyKey: key(),
    ...extra,
  });
const respond = async (
  claimId: string,
  body: { accept: boolean; note?: string },
  token = f.owner,
) => {
  const current = await db.claim.findUniqueOrThrow({ where: { id: claimId } });
  return call(
    "POST",
    `/v1/stores/${f.storeA}/claims/${claimId}/respond`,
    token,
    { ...body, expectedVersion: current.version },
  );
};
const earnings = async () =>
  (await call("GET", `/v1/stores/${f.storeA}/earnings`, f.owner)).json();

before(async () => {
  const a = await shop("Atelier A");
  const b = await shop("Boutique B");
  const owner = await user();
  const packer = await user();
  const ownerB = await user();
  for (const [u, tenantId, storeId, role] of [
    [owner, a.tenantId, a.store.id, "OWNER"],
    [packer, a.tenantId, a.store.id, "FULFILLMENT"],
    [ownerB, b.tenantId, b.store.id, "OWNER"],
  ] as const)
    await db.storeMember.create({
      data: { tenantId, storeId, userId: u.id, role },
    });
  const method = await db.paymentMethod.create({
    data: {
      code: methodCode,
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
  const rule = await db.commissionRule.create({
    data: {
      storeId: a.store.id,
      basisPoints: 500,
      label: "Test 5 %",
      validFrom: new Date(Date.now() - 1000),
      createdBy: owner.id,
    },
  });
  ids.rule = rule.id;
  Object.assign(f, {
    storeA: a.store.id,
    slugA: a.store.slug,
    variantA: a.variantId,
    storeB: b.store.id,
    owner: owner.token,
    packer: packer.token,
    ownerB: ownerB.token,
    buyer: (await user()).token,
    buyer2: (await user()).token,
    admin: (await user("ADMIN")).token,
    support: (await user("SUPPORT")).token,
  });
  f.address = (
    await call("POST", "/v1/addresses", f.buyer, {
      label: "Maison",
      recipientName: "Awa Ngono",
      phone: "699 12 34 56",
      city: "Douala",
      district: "Akwa",
      landmark: "Face à la pharmacie",
    })
  ).json().id;
  f.main = await order(3);
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  const sellerOrders = await db.sellerOrder.findMany({
    where: { tenantId },
    select: { id: true },
  });
  const payments = await db.payment.findMany({
    where: { buyerId: userId },
    select: { id: true },
  });
  const refunds = await db.refund.findMany({
    where: { tenantId },
    select: { id: true },
  });
  const sources = [...sellerOrders, ...payments, ...refunds].map((x) => x.id);
  await db.ledgerEntry.deleteMany({
    where: { journal: { sourceId: { in: sources } } },
  });
  await db.ledgerJournal.deleteMany({ where: { sourceId: { in: sources } } });
  await db.refund.deleteMany({ where: { tenantId } });
  await db.claimEvent.deleteMany({ where: { claim: { tenantId } } });
  await db.claimItem.deleteMany({ where: { tenantId } });
  await db.claim.deleteMany({ where: { tenantId } });
  await db.commissionRule.delete({ where: { id: ids.rule } });
  await db.handoverCode.deleteMany({ where: { buyerId: userId } });
  await db.fulfilmentEvent.deleteMany({ where: { tenantId } });
  await db.notification.deleteMany({ where: { userId } });
  await db.outboxEvent.deleteMany({ where: { tenantId } });
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
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("opening a claim", () => {
  test("only after a proven handover, within 7 days, by the buyer, for bought quantities", async () => {
    const undelivered = await order(1, false);
    assert.equal((await claim(undelivered, 1)).json().error, "window_closed");
    assert.equal((await claim(f.main, 1, {}, f.buyer2)).statusCode, 404);
    assert.equal((await claim(f.main, 4)).json().error, "quantity_exceeded");
    assert.equal(
      (await claim(f.main, 1, { description: "court" })).statusCode,
      400,
    );
    const old = await order(1);
    await db.sellerOrder.update({
      where: { id: old.sellerOrderId },
      data: { deliveredAt: new Date(Date.now() - 8 * 86400_000) },
    });
    assert.equal((await claim(old, 1)).json().error, "window_closed");
  });

  test("an open claim freezes the payout and blocks a second claim; replays are idempotent", async () => {
    const k = key();
    const opened = await claim(f.main, 2, { idempotencyKey: k });
    assert.equal(opened.statusCode, 201, opened.body);
    assert.equal(opened.json().status, "OPEN");
    assert.equal(opened.json().amount.amountMinor, "20000");
    f.claimId = opened.json().id;
    const replay = await claim(f.main, 2, { idempotencyKey: k });
    assert.equal(replay.statusCode, 200);
    assert.equal(replay.json().id, f.claimId);
    assert.equal((await claim(f.main, 1)).json().error, "claim_in_progress");
    const view = (
      await call("GET", `/v1/orders/${f.main.orderId}`, f.buyer)
    ).json().sellers[0];
    assert.equal(view.claimable, false);
    assert.equal(view.claims[0].status, "OPEN");
    // Échéance = remise + délai de réclamation en vigueur à la remise (7 jours, paramètre daté).
    const so = await db.sellerOrder.findUniqueOrThrow({
      where: { id: f.main.sellerOrderId },
    });
    assert.equal(
      view.claimDeadline,
      new Date((so.deliveredAt?.getTime() ?? 0) + 7 * 86400_000).toISOString(),
    );
    const e = await earnings();
    const line = e.lines.find(
      (l: { sellerOrderId: string }) =>
        l.sellerOrderId === f.main.sellerOrderId,
    );
    assert.equal(line.onHold, true);
    // 3 × 10 000 + 1 000 − 5 % de 30 000 = 29 500 gelés.
    assert.equal(e.held.amountMinor, "29500");
  });
});

describe("answering and arbitrating", () => {
  test("only owner/manager answer; a refusal needs a reason; other stores see nothing", async () => {
    assert.equal(
      (
        await respond(
          f.claimId,
          { accept: false, note: "x".repeat(12) },
          f.packer,
        )
      ).statusCode,
      403,
    );
    assert.equal(
      (await call("GET", `/v1/stores/${f.storeB}/claims`, f.ownerB))
        .json()
        .claims.some((c: { id: string }) => c.id === f.claimId),
      false,
    );
    assert.equal(
      (await respond(f.claimId, { accept: false })).json().error,
      "note_required",
    );
    const rejected = await respond(f.claimId, {
      accept: false,
      note: "Photo à l'appui : article intact au départ.",
    });
    assert.equal(rejected.statusCode, 200, rejected.body);
  });

  test("the buyer escalates; support reviews but only an admin decides the refund", async () => {
    assert.equal(
      (await call("POST", `/v1/claims/${f.claimId}/escalate`, f.buyer2))
        .statusCode,
      404,
    );
    assert.equal(
      (await call("POST", `/v1/claims/${f.claimId}/escalate`, f.buyer))
        .statusCode,
      200,
    );
    const queue = await call("GET", "/v1/admin/claims", f.support);
    assert.equal(queue.statusCode, 200);
    assert.equal(queue.json().canDecide, false);
    assert.ok(
      queue.json().claims.some((c: { id: string }) => c.id === f.claimId),
    );
    const note = "Photos concordantes : remboursement des 2 pagnes.";
    assert.equal(
      (
        await call("POST", `/v1/admin/claims/${f.claimId}/decide`, f.support, {
          refund: true,
          note,
        })
      ).statusCode,
      403,
    );
    // Médiation (ADR 0015) ; l'ancienne route /decide reste un alias (refus SUPPORT ci-dessus).
    const decided = await call(
      "POST",
      `/v1/admin/claims/${f.claimId}/mediate`,
      f.admin,
      { refund: true, note },
    );
    assert.equal(decided.statusCode, 200, decided.body);
    assert.equal(decided.json().status, "REFUND_APPROVED");
  });

  test("the refund is booked: seller debited net of the reversed commission, buyer owed", async () => {
    const refund = await db.refund.findUniqueOrThrow({
      where: { claimId: f.claimId },
    });
    assert.equal(refund.amountMinor, 20000n);
    assert.equal(refund.commissionReversedMinor, 1000n);
    assert.equal(refund.sellerDebitMinor, 19000n);
    assert.equal(refund.status, "PENDING_PROVIDER");
    const lines = await db.ledgerEntry.findMany({
      where: { journal: { kind: "refund_decided", sourceId: refund.id } },
      select: { account: true, amountMinor: true },
      orderBy: { account: "asc" },
    });
    // Commission reprise TVA comprise (lot 4) : 1 000 = 839 de revenu + 161 de TVA (19,25 %).
    assert.deepEqual(lines, [
      { account: "SELLER_PAYABLE", amountMinor: 19000n },
      { account: "COMMISSION_REVENUE", amountMinor: 839n },
      { account: "REFUND_PAYABLE", amountMinor: -20000n },
      { account: "VAT_COLLECTED", amountMinor: 161n },
    ]);
    assert.equal(refund.commissionVatReversedMinor, 161n);
    assert.equal(refund.reversedFrom, "REVENUE");
    const e = await earnings();
    const line = e.lines.find(
      (l: { sellerOrderId: string }) =>
        l.sellerOrderId === f.main.sellerOrderId,
    );
    assert.equal(line.onHold, false);
    assert.equal(line.refunded.amountMinor, "19000");
    const pending = await call("GET", "/v1/admin/payments", f.admin);
    assert.ok(
      pending.json().refunds.some((r: { id: string }) => r.id === refund.id),
    );
  });

  test("a later claim covers only what is left, and commission is never reversed twice", async () => {
    const second = await claim(f.main, 1);
    assert.equal(second.statusCode, 201, second.body);
    assert.equal(
      (await respond(second.json().id, { accept: true })).statusCode,
      200,
    );
    const refund = await db.refund.findUniqueOrThrow({
      where: { claimId: second.json().id },
    });
    // Commission initiale 1 500 : 1 000 déjà reprise, 500 restant.
    assert.equal(refund.commissionReversedMinor, 500n);
    assert.equal(refund.sellerDebitMinor, 9500n);
    assert.equal((await claim(f.main, 1)).json().error, "quantity_exceeded");
  });

  test("a withdrawn claim releases the payout", async () => {
    const other = await order(1);
    const opened = await claim(other, 1);
    assert.equal(
      (await call("POST", `/v1/claims/${opened.json().id}/withdraw`, f.buyer))
        .statusCode,
      200,
    );
    const e = await earnings();
    assert.equal(
      e.lines.find(
        (l: { sellerOrderId: string }) =>
          l.sellerOrderId === other.sellerOrderId,
      ).onHold,
      false,
    );
    assert.equal(
      (
        await call("POST", `/v1/claims/${opened.json().id}/escalate`, f.buyer)
      ).json().error,
      "invalid_transition",
    );
  });
});
