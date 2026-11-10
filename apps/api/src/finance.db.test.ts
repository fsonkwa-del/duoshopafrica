import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  asRuntime,
  createDatabase,
  expireUnpaidOrders,
  issueSessionToken,
} from "@duoshop/database";
import { commissionMinor } from "@duoshop/domain";
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
const methodCode = `TEST_FIN_${randomUUID().slice(0, 6).toUpperCase().replaceAll("-", "")}`;
const ids = {
  tenants: [] as string[],
  users: [] as string[],
  rules: [] as string[],
  method: "",
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
  owner: "",
  catalog: "",
  buyer: "",
  finance: "",
  admin: "",
  support: "",
  stranger: "",
  address: "",
  mixed: { orderId: "", paymentId: "" },
};

async function user(
  options: { platform?: "ADMIN" | "SUPPORT" | "FINANCE" } = {},
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
      mfa: Boolean(options.platform),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return { id: created.id, token };
}
async function shop(name: string, price: bigint): Promise<Shop> {
  const tenant = await db.tenant.create({
    data: { name: `TEST-B08-${name}`, status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name,
      deliveryFeeMinor: 1000n,
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
      title: `${name} article`,
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `B8-${randomUUID().slice(0, 8)}`,
      label: "Standard",
      priceMinor: price,
      currency: "XAF",
    },
  });
  await db.stockLevel.create({
    data: {
      tenantId: tenant.id,
      variantId: variant.id,
      locationId: location.id,
      onHand: 50,
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
const soon = (ms = 0) => new Date(Date.now() + ms).toISOString();
const rule = async (body: object) => {
  const res = await call("POST", "/v1/admin/commission-rules", f.finance, body);
  if (res.statusCode === 201) ids.rules.push(res.json().id);
  return res;
};
// Commande payée par webhook signé : A (2 × 10 000, domicile 1 000) + B (1 × 8 111, retrait).
async function payMixed(): Promise<{ orderId: string; paymentId: string }> {
  await call("POST", "/v1/cart/items", f.buyer, {
    variantId: f.a.variant,
    quantity: 2,
  });
  await call("POST", "/v1/cart/items", f.buyer, {
    variantId: f.b.variant,
    quantity: 1,
  });
  const placed = await call("POST", "/v1/orders", f.buyer, {
    idempotencyKey: randomUUID().replaceAll("-", ""),
    deliveries: [
      { storeSlug: f.a.slug, method: "HOME_DELIVERY" },
      { storeSlug: f.b.slug, method: "PICKUP" },
    ],
    addressId: f.address,
    expectedTotalMinor: "29111",
  });
  assert.equal(placed.statusCode, 201, placed.body);
  return pay(placed.json().id);
}
async function pay(orderId: string, settle = true) {
  const started = await call(
    "POST",
    `/v1/orders/${orderId}/payments`,
    f.buyer,
    {
      methodCode,
      idempotencyKey: randomUUID().replaceAll("-", ""),
      payerPhone: "677 11 22 33",
    },
  );
  const paymentId = started.json().id as string;
  if (settle) await webhook(paymentId);
  return { orderId, paymentId };
}
async function webhook(paymentId: string) {
  const payment = await db.payment.findUniqueOrThrow({
    where: { id: paymentId },
  });
  const body = mockEventBody({
    paymentId,
    providerReference: payment.providerReference ?? "",
    status: "SUCCEEDED",
    amountMinor: payment.amountMinor,
    currency: "XAF",
  });
  const res = await app.inject({
    method: "POST",
    url: "/v1/payments/webhooks/mock",
    headers: {
      "content-type": "application/json",
      [MOCK_SIGNATURE_HEADER]: signMockBody(secret, body),
    },
    payload: body,
  });
  assert.equal(res.json().outcome, "APPLIED");
}
const journalLines = (kind: string, sourceId: string) =>
  db.ledgerEntry.findMany({
    where: { journal: { kind, sourceId } },
    select: { account: true, amountMinor: true, tenantId: true },
    orderBy: { account: "asc" },
  });

before(async () => {
  f.a = await shop("Atelier A", 10000n);
  f.b = await shop("Boutique B", 8111n);
  const owner = await user();
  const catalog = await user();
  for (const [u, role] of [
    [owner, "OWNER"],
    [catalog, "CATALOG"],
  ] as const)
    await db.storeMember.create({
      data: {
        tenantId: f.a.tenantId,
        storeId: f.a.storeId,
        userId: u.id,
        role,
      },
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
  Object.assign(f, {
    owner: owner.token,
    catalog: catalog.token,
    buyer: (await user()).token,
    finance: (await user({ platform: "FINANCE" })).token,
    admin: (await user({ platform: "ADMIN" })).token,
    support: (await user({ platform: "SUPPORT" })).token,
    stranger: (await user()).token,
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
  const sources = [...sellerOrders, ...payments].map((x) => x.id);
  await db.ledgerEntry.deleteMany({
    where: { journal: { sourceId: { in: sources } } },
  });
  await db.ledgerJournal.deleteMany({ where: { sourceId: { in: sources } } });
  await db.configAudit.deleteMany({ where: { entityId: { in: ids.rules } } });
  await db.commissionRule.deleteMany({ where: { id: { in: ids.rules } } });
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

describe("commission rules", () => {
  test("finance configures, admin only reviews, support and others see nothing", async () => {
    const url = "/v1/admin/commission-rules";
    assert.equal((await call("GET", url, f.stranger)).statusCode, 404);
    assert.equal((await call("GET", url, f.support)).statusCode, 403);
    const adminView = await call("GET", url, f.admin);
    assert.equal(adminView.statusCode, 200);
    assert.equal(adminView.json().canConfigure, false);
    assert.equal(
      (
        await call("POST", url, f.admin, {
          basisPoints: 500,
          label: "Taux admin",
          validFrom: soon(),
        })
      ).statusCode,
      403,
    );
  });

  test("dated, bounded, never retroactive; store rules are explicit", async () => {
    assert.equal(
      (
        await rule({
          basisPoints: 500,
          label: "Rétroactif",
          validFrom: soon(-3600_000),
        })
      ).json().error,
      "retroactive_rule",
    );
    assert.equal(
      (await rule({ basisPoints: 10001, label: "Trop", validFrom: soon() }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await rule({
          storeId: randomUUID(),
          basisPoints: 500,
          label: "Boutique inconnue",
          validFrom: soon(),
        })
      ).statusCode,
      404,
    );
    // Simulation (cahier : 5 % standard non validé) : règle propre à A, défaut 4,5 % pour B.
    assert.equal(
      (
        await rule({
          storeId: f.a.storeId,
          basisPoints: 500,
          label: "Simulation 5 % — Atelier A",
          validFrom: soon(-1000),
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await rule({
          basisPoints: 450,
          label: "Simulation défaut 4,5 %",
          validFrom: soon(-1000),
        })
      ).statusCode,
      201,
    );
    assert.equal(
      await db.configAudit.count({
        where: { entityId: { in: ids.rules }, action: "create" },
      }),
      2,
    );
  });
});

describe("posting a paid order", () => {
  test("snapshots commission per seller (half-up) and books a balanced journal", async () => {
    f.mixed = await payMixed();
    const sellers = await db.sellerOrder.findMany({
      where: { orderId: f.mixed.orderId },
    });
    const a = sellers.find((s) => s.tenantId === f.a.tenantId);
    const b = sellers.find((s) => s.tenantId === f.b.tenantId);
    assert.ok(a && b);
    assert.equal(a.commissionBasisPoints, 500);
    assert.equal(a.commissionBaseMinor, 20000n);
    assert.equal(a.commissionMinor, 1000n);
    assert.equal(a.sellerNetMinor, 20000n);
    // 8 111 × 4,5 % = 364,995 → 365 (half-up), même calcul que le domaine.
    assert.equal(b.commissionBasisPoints, 450);
    assert.equal(b.commissionMinor, commissionMinor(8111n, 450));
    assert.equal(b.commissionMinor, 365n);
    assert.equal(b.sellerNetMinor, 8111n - 365n);
    assert.deepEqual(
      await journalLines("order_paid", a.id),
      [
        { account: "PSP_CLEARING", amountMinor: 21000n, tenantId: null },
        {
          account: "SELLER_PAYABLE",
          amountMinor: -20000n,
          tenantId: f.a.tenantId,
        },
        { account: "COMMISSION_DEFERRED", amountMinor: -1000n, tenantId: null },
      ],
      // Ordre de l'enum LedgerAccount (tri en base).
    );
    const clearing = await db.ledgerEntry.aggregate({
      where: {
        account: "PSP_CLEARING",
        journal: { kind: "order_paid", sourceId: { in: [a.id, b.id] } },
      },
      _sum: { amountMinor: true },
    });
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: f.mixed.paymentId },
    });
    assert.equal(clearing._sum.amountMinor, payment.amountMinor);
  });

  test("a new rule never changes a past snapshot", async () => {
    await rule({
      storeId: f.a.storeId,
      basisPoints: 300,
      label: "Simulation 3 % — Atelier A",
      validFrom: soon(-500),
    });
    const later = await payMixed();
    const [past, next] = await Promise.all(
      [f.mixed.orderId, later.orderId].map((orderId) =>
        db.sellerOrder.findFirstOrThrow({
          where: { orderId, tenantId: f.a.tenantId },
        }),
      ),
    );
    assert.equal(past?.commissionBasisPoints, 500);
    assert.equal(next?.commissionBasisPoints, 300);
    assert.equal(next?.commissionMinor, 600n);
  });

  test("commission is earned only when the handover is proven", async () => {
    const so = await db.sellerOrder.findFirstOrThrow({
      where: { orderId: f.mixed.orderId, tenantId: f.a.tenantId },
    });
    const before = await call(
      "GET",
      `/v1/stores/${f.a.storeId}/earnings`,
      f.owner,
    );
    assert.equal(before.statusCode, 200);
    assert.equal(
      (await call("GET", `/v1/stores/${f.a.storeId}/earnings`, f.catalog))
        .statusCode,
      403,
    );
    const pendingBefore = BigInt(before.json().pending.amountMinor);
    assert.deepEqual(await journalLines("commission_earned", so.id), []);
    const code = (
      await db.handoverCode.findUniqueOrThrow({
        where: { sellerOrderId: so.id },
      })
    ).code;
    for (const step of [
      { to: "READY" },
      { to: "OUT_FOR_DELIVERY" },
      { to: "DELIVERED", code },
    ]) {
      const current = await db.sellerOrder.findUniqueOrThrow({
        where: { id: so.id },
      });
      const res = await call(
        "POST",
        `/v1/stores/${f.a.storeId}/orders/${so.id}/fulfilment`,
        f.owner,
        { ...step, expectedVersion: current.fulfilmentVersion },
      );
      assert.equal(res.statusCode, 200, res.body);
    }
    // Commission TVA comprise (lot 4) : 1 000 = 839 de revenu + 161 de TVA collectée (19,25 %).
    assert.deepEqual(await journalLines("commission_earned", so.id), [
      { account: "COMMISSION_DEFERRED", amountMinor: 1000n, tenantId: null },
      { account: "COMMISSION_REVENUE", amountMinor: -839n, tenantId: null },
      { account: "VAT_COLLECTED", amountMinor: -161n, tenantId: null },
    ]);
    const afterView = (
      await call("GET", `/v1/stores/${f.a.storeId}/earnings`, f.owner)
    ).json();
    assert.equal(BigInt(afterView.pending.amountMinor), pendingBefore - 20000n);
    assert.equal(afterView.earned.amountMinor, "20000");
    const line = afterView.lines.find(
      (l: { sellerOrderId: string }) => l.sellerOrderId === so.id,
    );
    assert.deepEqual(
      [
        line.gross.amountMinor,
        line.commission.amountMinor,
        line.net.amountMinor,
      ],
      ["21000", "1000", "20000"],
    );
  });

  test("money received for a closed order is booked as owed back to the buyer", async () => {
    await call("POST", "/v1/cart/items", f.buyer, {
      variantId: f.b.variant,
      quantity: 1,
    });
    const placed = await call("POST", "/v1/orders", f.buyer, {
      idempotencyKey: randomUUID().replaceAll("-", ""),
      deliveries: [{ storeSlug: f.b.slug, method: "PICKUP" }],
      expectedTotalMinor: "8111",
    });
    const { paymentId } = await pay(placed.json().id, false);
    await db.order.update({
      where: { id: placed.json().id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expireUnpaidOrders(db);
    // Article retiré entre-temps : pas de confirmation tardive possible (lot 3).
    await db.productVariant.update({
      where: { id: f.b.variant },
      data: { active: false },
    });
    await webhook(paymentId);
    await db.productVariant.update({
      where: { id: f.b.variant },
      data: { active: true },
    });
    assert.deepEqual(await journalLines("unapplied_payment", paymentId), [
      { account: "PSP_CLEARING", amountMinor: 8111n, tenantId: null },
      { account: "REFUND_PAYABLE", amountMinor: -8111n, tenantId: null },
    ]);
  });
});

describe("ledger integrity and reconciliation", () => {
  test("an unbalanced journal cannot be committed; the runtime cannot write or rewrite", async () => {
    await assert.rejects(
      db.$transaction(async (tx) => {
        const journal = await tx.ledgerJournal.create({
          data: {
            kind: "test_unbalanced",
            sourceId: randomUUID(),
            currency: "XAF",
            description: "test",
          },
        });
        await tx.ledgerEntry.createMany({
          data: [
            {
              journalId: journal.id,
              account: "PSP_CLEARING",
              amountMinor: 100n,
            },
            {
              journalId: journal.id,
              account: "COMMISSION_REVENUE",
              amountMinor: -99n,
            },
          ],
        });
      }),
      /unbalanced ledger journal|23514/,
    );
    for (const statement of [
      `UPDATE "LedgerEntry" SET "amountMinor" = 1`,
      `DELETE FROM "LedgerJournal"`,
      `INSERT INTO "LedgerJournal" ("id","kind","sourceId","currency","description") VALUES (gen_random_uuid(),'x','y','XAF','z')`,
    ])
      await assert.rejects(
        asRuntime(db, {}, (tx) => tx.$executeRawUnsafe(statement)),
        /permission denied|42501/i,
      );
  });

  test("finance sees balances, payables and no gap for these payments", async () => {
    const report = await call("GET", "/v1/admin/finance", f.finance);
    assert.equal(report.statusCode, 200, report.body);
    const body = report.json();
    const payable = body.payables.find(
      (p: { tenantId: string }) => p.tenantId === f.a.tenantId,
    );
    // Deux commandes A : 20 000 (5 %) + 20 000 (3 %, net 20 400 = 21 000 − 600).
    assert.equal(payable.amount, String(20000 + 20400));
    const mine = await db.payment.findMany({
      where: { orderId: { in: [f.mixed.orderId] } },
      select: { id: true },
    });
    assert.equal(
      body.anomalies.filter(
        (a: { kind: string; reference: string }) =>
          a.kind === "payment_not_journaled" &&
          mine.some((p) => p.id === a.reference),
      ).length,
      0,
    );
    assert.ok(Array.isArray(body.daily) && body.daily.length === 7);
    assert.equal(
      (await call("GET", "/v1/admin/finance", f.admin)).statusCode,
      200,
    );
    assert.equal(
      (await call("GET", "/v1/admin/finance", f.support)).statusCode,
      403,
    );
    assert.equal(
      (
        await call(
          "GET",
          "/v1/admin/finance?from=2026-01-01&to=2026-12-31",
          f.finance,
        )
      ).json().error,
      "invalid_period",
    );
  });
});
