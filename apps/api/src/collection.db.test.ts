import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import {
  collectionFromEnv,
  MOCK_SIGNATURE_HEADER,
  mockEventBody,
  providersFromEnv,
  signMockBody,
} from "@duoshop/payments";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";
import { assertCollectionMode } from "./collection";

// Lot 3 (ADR 0011) : mode direct vendeur. L'acheteur paie le compte marchand du vendeur (ici le
// simulateur, un secret par compte) ; la plateforme ne constate qu'une créance de commission ;
// un événement ne vaut que pour les paiements du compte qui l'a vérifié.
const db = createDatabase({ max: 6 });
const webOrigin = "http://localhost:3000";
const platformSecret = randomUUID() + randomUUID();
const env = {
  PAYMENTS_MOCK_ENABLED: "true",
  PAYMENTS_MOCK_SECRET: platformSecret,
  COLLECTION_MODE: "DIRECT_SELLER",
  PAYMENT_ACCOUNTS_KEY_1: randomBytes(32).toString("base64"),
};
const app = await createApp({
  logger: process.env.TEST_LOG === "1",
  db,
  webOrigin,
  providers: providersFromEnv(env),
  collection: collectionFromEnv(env),
  env,
});
const methodCode = `TEST_DIR_${randomUUID().slice(0, 6).toUpperCase().replaceAll("-", "")}`;
const ids = {
  tenants: [] as string[],
  users: [] as string[],
  method: "",
  rule: "",
};
type Shop = {
  tenantId: string;
  storeId: string;
  slug: string;
  variant: string;
};
const f = {
  a: {} as Shop,
  b: {} as Shop,
  ownerA: "",
  ownerB: "",
  catalogA: "",
  buyer: "",
  secretA: randomUUID() + randomUUID(),
  secretB: randomUUID() + randomUUID(),
  accountA: "",
  accountB: "",
  orderId: "",
  paymentId: "",
};

async function user(platform?: "ADMIN" | "FINANCE") {
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
async function shop(name: string): Promise<Shop> {
  const tenant = await db.tenant.create({
    data: { name: `TEST-${name}`, status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name,
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
      title: `Pagne ${name}`,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `D-${randomUUID().slice(0, 8)}`,
      label: "6 yards",
      priceMinor: 20000n,
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
  return {
    tenantId: tenant.id,
    storeId: store.id,
    slug: store.slug,
    variant: variant.id,
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
const key = () => randomUUID().replaceAll("-", "");
const event = (
  paymentId: string,
  reference: string,
  amount: bigint,
  id = randomUUID(),
) =>
  mockEventBody({
    eventId: `test_dir_${id}`,
    paymentId,
    providerReference: reference,
    status: "SUCCEEDED",
    amountMinor: amount,
    currency: "XAF",
  });
const post = (url: string, secret: string, body: string) =>
  app.inject({
    method: "POST",
    url,
    headers: {
      "content-type": "application/json",
      [MOCK_SIGNATURE_HEADER]: signMockBody(secret, body),
    },
    payload: body,
  });
const lines = (kind: string, sourceId: string) =>
  db.ledgerEntry.findMany({
    where: { journal: { kind, sourceId } },
    select: { account: true, amountMinor: true, tenantId: true },
    orderBy: { account: "asc" },
  });

before(async () => {
  f.a = await shop("Direct A");
  f.b = await shop("Direct B");
  const ownerA = await user();
  const ownerB = await user();
  const catalogA = await user();
  for (const [u, s, role] of [
    [ownerA, f.a, "OWNER"],
    [catalogA, f.a, "CATALOG"],
    [ownerB, f.b, "OWNER"],
  ] as const)
    await db.storeMember.create({
      data: { tenantId: s.tenantId, storeId: s.storeId, userId: u.id, role },
    });
  f.ownerA = ownerA.token;
  f.ownerB = ownerB.token;
  f.catalogA = catalogA.token;
  f.buyer = (await user()).token;
  ids.method = (
    await db.paymentMethod.create({
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
    })
  ).id;
  ids.rule = (
    await db.commissionRule.create({
      data: {
        storeId: f.a.storeId,
        basisPoints: 1000,
        label: "Test 10 % direct",
        validFrom: new Date(Date.now() - 1000),
        createdBy: ownerA.id,
      },
    })
  ).id;
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  const orders = await db.order.findMany({
    where: { buyerId: userId },
    select: { id: true },
  });
  const orderIds = orders.map((o) => o.id);
  const sellerOrders = await db.sellerOrder.findMany({
    where: { tenantId },
    select: { id: true },
  });
  const refunds = await db.refund.findMany({
    where: { tenantId },
    select: { id: true },
  });
  const payments = await db.payment.findMany({
    where: { orderId: { in: orderIds } },
    select: { id: true },
  });
  const sources = [
    ...sellerOrders.map((s) => s.id),
    ...refunds.map((r) => r.id),
    ...payments.map((p) => p.id),
  ];
  await db.ledgerEntry.deleteMany({
    where: { journal: { sourceId: { in: sources } } },
  });
  await db.ledgerJournal.deleteMany({ where: { sourceId: { in: sources } } });
  await db.refund.deleteMany({ where: { tenantId } });
  await db.claimEvent.deleteMany({ where: { claim: { tenantId } } });
  await db.claimItem.deleteMany({ where: { tenantId } });
  await db.claim.deleteMany({ where: { tenantId } });
  await db.handoverCode.deleteMany({
    where: { sellerOrderId: { in: sources } },
  });
  await db.fulfilmentEvent.deleteMany({ where: { tenantId } });
  await db.notification.deleteMany({ where: { userId } });
  await db.outboxEvent.deleteMany({ where: { tenantId } });
  await db.providerEvent.deleteMany({
    where: { paymentId: { in: payments.map((p) => p.id) } },
  });
  await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.stockMovement.deleteMany({ where: { tenantId } });
  await db.orderItem.deleteMany({ where: { tenantId } });
  await db.sellerOrder.deleteMany({ where: { tenantId } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.cartItem.deleteMany({ where: { cart: { userId } } });
  await db.cart.deleteMany({ where: { userId } });
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.storePaymentAccount.deleteMany({ where: { tenantId } });
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.commissionRule.deleteMany({ where: { id: ids.rule } });
  await db.paymentMethod.deleteMany({ where: { id: ids.method } });
  await db.configAudit.deleteMany({ where: { actorId: { in: ids.users } } });
  await db.collectionModeAuthorization.deleteMany({
    where: { requestedBy: { in: ids.users } },
  });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("direct seller collection", () => {
  test("the owner registers the merchant account; credentials are sealed and never returned", async () => {
    const url = (s: Shop) => `/v1/stores/${s.storeId}/payment-account`;
    const body = (secret: string) => ({
      provider: "mock",
      mode: "MOCK",
      credentials: { secret },
    });
    assert.equal(
      (await call("POST", url(f.a), f.catalogA, body(f.secretA))).statusCode,
      403,
    );
    assert.equal(
      (
        await call("POST", url(f.a), f.ownerA, {
          provider: "mock",
          mode: "MOCK",
          credentials: { secret: f.secretA, extra: "x" },
        })
      ).json().error,
      "invalid_credentials",
    );
    const saved = await call("POST", url(f.a), f.ownerA, body(f.secretA));
    assert.equal(saved.statusCode, 200, saved.body);
    assert.ok(!saved.body.includes(f.secretA));
    f.accountA = saved.json().id;
    assert.equal(
      saved.json().notifyUrl,
      `${webOrigin}/v1/payments/webhooks/mock/accounts/${f.accountA}`,
    );
    f.accountB = (
      await call("POST", url(f.b), f.ownerB, body(f.secretB))
    ).json().id;
    const row = await db.storePaymentAccount.findUniqueOrThrow({
      where: { id: f.accountA },
    });
    assert.ok(
      !Buffer.from(row.credentials).toString("latin1").includes(f.secretA),
    );
    const listed = await call("GET", url(f.a), f.ownerA);
    assert.equal(listed.json().collectionMode, "DIRECT_SELLER");
    assert.ok(!listed.body.includes(f.secretA));
  });

  test("an order holds one seller only", async () => {
    for (const s of [f.a, f.b])
      await call("POST", "/v1/cart/items", f.buyer, {
        variantId: s.variant,
        quantity: 1,
      });
    const quote = await call("POST", "/v1/checkout/quote", f.buyer, {
      deliveries: [
        { storeSlug: f.a.slug, method: "PICKUP" },
        { storeSlug: f.b.slug, method: "PICKUP" },
      ],
    });
    assert.equal(quote.json().error, "one_seller_per_order");
    await call("POST", "/v1/cart/items", f.buyer, {
      variantId: f.b.variant,
      quantity: 0,
    });
    const placed = await call("POST", "/v1/orders", f.buyer, {
      idempotencyKey: key(),
      deliveries: [{ storeSlug: f.a.slug, method: "PICKUP" }],
      expectedTotalMinor: "20000",
    });
    assert.equal(placed.statusCode, 201, placed.body);
    f.orderId = placed.json().id;
  });

  test("the buyer pays the seller's account; the platform only books a commission receivable", async () => {
    const methods = await call(
      "GET",
      `/v1/orders/${f.orderId}/payment-methods`,
      f.buyer,
    );
    assert.ok(
      methods
        .json()
        .methods.some((m: { code: string }) => m.code === methodCode),
    );
    const started = await call(
      "POST",
      `/v1/orders/${f.orderId}/payments`,
      f.buyer,
      {
        methodCode,
        idempotencyKey: key(),
        payerPhone: "677 11 22 33",
      },
    );
    assert.equal(started.statusCode, 201, started.body);
    f.paymentId = started.json().id;
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: f.paymentId },
    });
    assert.equal(payment.collectionMode, "DIRECT_SELLER");
    assert.equal(payment.storeAccountId, f.accountA);
    const reference = payment.providerReference ?? "";

    // Signé par la plateforme ou par un autre vendeur : jamais appliqué à ce paiement.
    const platform = await post(
      "/v1/payments/webhooks/mock",
      platformSecret,
      event(f.paymentId, reference, 20000n),
    );
    assert.equal(platform.json().outcome, "QUARANTINED");
    const other = await post(
      `/v1/payments/webhooks/mock/accounts/${f.accountB}`,
      f.secretB,
      event(f.paymentId, reference, 20000n),
    );
    assert.equal(other.json().outcome, "QUARANTINED");
    assert.equal(
      (await db.order.findUniqueOrThrow({ where: { id: f.orderId } })).status,
      "AWAITING_PAYMENT",
    );
    const mismatch = await db.providerEvent.count({
      where: { paymentId: f.paymentId, detail: "account_mismatch" },
    });
    assert.equal(mismatch, 2);

    const own = await post(
      `/v1/payments/webhooks/mock/accounts/${f.accountA}`,
      f.secretA,
      event(f.paymentId, reference, 20000n),
    );
    assert.equal(own.json().outcome, "APPLIED");
    const order = await db.order.findUniqueOrThrow({
      where: { id: f.orderId },
      include: { sellerOrders: true },
    });
    assert.equal(order.status, "PAID");
    const so = order.sellerOrders[0];
    assert.equal(so?.commissionMinor, 2000n);
    // Ni fonds chez le prestataire ni dette envers le vendeur : seulement la créance de commission.
    assert.deepEqual(await lines("order_paid", so?.id ?? ""), [
      { account: "COMMISSION_DEFERRED", amountMinor: -2000n, tenantId: null },
      {
        account: "COMMISSION_RECEIVABLE",
        amountMinor: 2000n,
        tenantId: f.a.tenantId,
      },
    ]);
  });

  test("a refund decided in direct mode is executed by the seller; only the commission is reversed", async () => {
    const so = await db.sellerOrder.findFirstOrThrow({
      where: { orderId: f.orderId },
      include: { handover: true, items: true },
    });
    for (const step of [
      { to: "READY" },
      { to: "DELIVERED", code: so.handover?.code },
    ]) {
      const current = await db.sellerOrder.findUniqueOrThrow({
        where: { id: so.id },
      });
      const res = await call(
        "POST",
        `/v1/stores/${f.a.storeId}/orders/${so.id}/fulfilment`,
        f.ownerA,
        { ...step, expectedVersion: current.fulfilmentVersion },
      );
      assert.equal(res.statusCode, 200, res.body);
    }
    const opened = await call(
      "POST",
      `/v1/orders/${f.orderId}/claims`,
      f.buyer,
      {
        sellerOrderId: so.id,
        reason: "DAMAGED",
        description: "Le tissu est déchiré sur toute la longueur.",
        items: [{ orderItemId: so.items[0]?.id, quantity: 1 }],
        idempotencyKey: key(),
      },
    );
    assert.equal(opened.statusCode, 201, opened.body);
    const claim = await db.claim.findUniqueOrThrow({
      where: { id: opened.json().id },
    });
    const accepted = await call(
      "POST",
      `/v1/stores/${f.a.storeId}/claims/${claim.id}/respond`,
      f.ownerA,
      { accept: true, expectedVersion: claim.version },
    );
    assert.equal(accepted.statusCode, 200, accepted.body);
    const refund = await db.refund.findUniqueOrThrow({
      where: { claimId: claim.id },
    });
    assert.equal(refund.status, "SELLER_TO_EXECUTE");
    // Reprise TVA comprise (lot 4) : 2 000 = 1 677 de revenu + 323 de TVA.
    assert.deepEqual(await lines("refund_decided", refund.id), [
      { account: "COMMISSION_REVENUE", amountMinor: 1677n, tenantId: null },
      {
        account: "COMMISSION_RECEIVABLE",
        amountMinor: -2000n,
        tenantId: f.a.tenantId,
      },
      { account: "VAT_COLLECTED", amountMinor: 323n, tenantId: null },
    ]);
  });
});

describe("holding buyers' money", () => {
  test("in production the platform cannot hold funds without an authorization approved by two people", async () => {
    const platform = collectionFromEnv({ PAYMENTS_MOCK_ENABLED: "true" });
    // Argent réel : un prestataire de la plateforme en LIVE (aucun appel n'est fait ici).
    const providers = providersFromEnv({
      FAPSHI_API_USER: "u",
      FAPSHI_API_KEY: "k",
      FAPSHI_WEBHOOK_SECRET: "s",
      FAPSHI_MODE: "LIVE",
    });
    const production = { NODE_ENV: "production" };
    // Pré-production (sandbox) : le mode actuel reste permis sans autorisation.
    await assertCollectionMode(
      db,
      platform,
      providersFromEnv({
        FAPSHI_API_USER: "u",
        FAPSHI_API_KEY: "k",
        FAPSHI_WEBHOOK_SECRET: "s",
      }),
      production,
    );
    // Garde-fou : aucune autre suite ne laisse d'autorisation derrière elle.
    const already = await db.collectionModeAuthorization.count({
      where: { approvedAt: { not: null }, revokedAt: null },
    });
    if (already === 0)
      await assert.rejects(
        assertCollectionMode(db, platform, providers, production),
        /PLATFORM_HELD is forbidden in production/,
      );
    // Le séquestre exige des capacités qu'aucun adaptateur actuel n'a.
    await assert.rejects(
      assertCollectionMode(
        db,
        { ...platform, mode: "PSP_ESCROW" },
        providers,
        {},
      ),
      /split, payout, refund, balance/,
    );
    const admin = await user("ADMIN");
    const finance = await user("FINANCE");
    const expiresAt = new Date(Date.now() + 86400_000).toISOString();
    const asked = await call(
      "POST",
      "/v1/admin/collection-authorizations",
      finance.token,
      {
        mode: "PLATFORM_HELD",
        agrementReference: "Agrément test COBAC n° 0001",
        expiresAt,
      },
    );
    assert.equal(asked.statusCode, 403);
    const requested = await call(
      "POST",
      "/v1/admin/collection-authorizations",
      admin.token,
      {
        mode: "PLATFORM_HELD",
        agrementReference: "Agrément test COBAC n° 0001",
        expiresAt,
      },
    );
    assert.equal(requested.statusCode, 201, requested.body);
    const id = requested.json().id as string;
    assert.equal(
      (
        await call(
          "POST",
          `/v1/admin/collection-authorizations/${id}/approve`,
          admin.token,
        )
      ).statusCode,
      403,
    );
    const approved = await call(
      "POST",
      `/v1/admin/collection-authorizations/${id}/approve`,
      finance.token,
    );
    assert.equal(approved.statusCode, 200, approved.body);
    await assertCollectionMode(db, platform, providers, production);
    // Autorisation expirée ou révoquée : le verrou se referme.
    await db.collectionModeAuthorization.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    if (already === 0)
      await assert.rejects(
        assertCollectionMode(db, platform, providers, production),
        /PLATFORM_HELD is forbidden/,
      );
  });
});
