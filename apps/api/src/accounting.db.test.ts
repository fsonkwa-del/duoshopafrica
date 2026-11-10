import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  createDatabase,
  issueSessionToken,
  recognizeDueCommissions,
} from "@duoshop/database";
import {
  MOCK_SIGNATURE_HEADER,
  mockEventBody,
  providersFromEnv,
  signMockBody,
} from "@duoshop/payments";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

// Lot 4 (ADR 0012) : frais du prestataire, TVA extraite de la commission, constatation à la fin
// du délai de réclamation, factures et avoirs numérotés sans trou, exports CSV.
// Les valeurs de paramètres posées ici sont retirées en fin de suite.
const db = createDatabase({ max: 6 });
const webOrigin = "http://localhost:3000";
const secret = randomUUID() + randomUUID();
const app = await createApp({
  logger: process.env.TEST_LOG === "1",
  db,
  webOrigin,
  providers: providersFromEnv({
    PAYMENTS_MOCK_ENABLED: "true",
    PAYMENTS_MOCK_SECRET: secret,
  }),
});
const methodCode = `TEST_ACC_${randomUUID().slice(0, 6).toUpperCase().replaceAll("-", "")}`;
const ids = {
  tenants: [] as string[],
  users: [] as string[],
  method: "",
  rule: "",
  params: [] as string[],
  closed: [] as string[],
};
const f = {
  tenantId: "",
  storeId: "",
  slug: "",
  variant: "",
  owner: "",
  buyer: "",
  finance: "",
  admin: "",
  firstSo: "",
  lateSo: "",
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
// Valeur de paramètre posée directement (connexion propriétaire) : la période en vigueur est
// close à l'instant, puis rouverte en fin de suite.
async function setParam(key: string, value: string, storeId?: string) {
  const open = await db.regulatoryParameter.findMany({
    where: {
      key,
      storeId: storeId ?? null,
      effectiveTo: null,
      approvedAt: { not: null },
    },
  });
  const now = new Date();
  for (const p of open) {
    await db.regulatoryParameter.update({
      where: { id: p.id },
      data: { effectiveTo: now },
    });
    ids.closed.push(p.id);
  }
  const row = await db.regulatoryParameter.create({
    data: {
      key,
      value,
      storeId: storeId ?? null,
      effectiveFrom: now,
      approvedAt: now,
      legalBasis: "Test automatisé",
    },
  });
  ids.params.push(row.id);
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
const lines = (kind: string, sourceId: string) =>
  db.ledgerEntry.findMany({
    where: { journal: { kind, sourceId } },
    select: { account: true, amountMinor: true },
    orderBy: { account: "asc" },
  });
// Commande payée et remise : 1 article à 20 000, retrait en boutique.
async function paidAndDelivered(): Promise<string> {
  await call("POST", "/v1/cart/items", f.buyer, {
    variantId: f.variant,
    quantity: 1,
  });
  const placed = await call("POST", "/v1/orders", f.buyer, {
    idempotencyKey: key(),
    deliveries: [{ storeSlug: f.slug, method: "PICKUP" }],
    expectedTotalMinor: "20000",
  });
  assert.equal(placed.statusCode, 201, placed.body);
  const started = await call(
    "POST",
    `/v1/orders/${placed.json().id}/payments`,
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
    eventId: `test_acc_${randomUUID()}`,
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
    where: { orderId: placed.json().id },
    include: { handover: true },
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
      `/v1/stores/${f.storeId}/orders/${so.id}/fulfilment`,
      f.owner,
      {
        ...step,
        expectedVersion: current.fulfilmentVersion,
      },
    );
    assert.equal(res.statusCode, 200, res.body);
  }
  return so.id;
}

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-accounting", status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Boutique Compta",
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
      title: "Pagne compta",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `A-${randomUUID().slice(0, 8)}`,
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
      onHand: 20,
    },
  });
  const owner = await user();
  await db.storeMember.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      userId: owner.id,
      role: "OWNER",
    },
  });
  Object.assign(f, {
    tenantId: tenant.id,
    storeId: store.id,
    slug: store.slug,
    variant: variant.id,
    owner: owner.token,
    buyer: (await user()).token,
    finance: (await user("FINANCE")).token,
    admin: (await user("ADMIN")).token,
  });
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
        storeId: store.id,
        basisPoints: 1000,
        label: "Test 10 % compta",
        validFrom: new Date(Date.now() - 1000),
        createdBy: owner.id,
      },
    })
  ).id;
  // Frais du simulateur à 2 %, à la charge du vendeur pour cette boutique.
  await db.parameterDefinition.upsert({
    where: { key: "psp.fee_rate.mock" },
    create: {
      key: "psp.fee_rate.mock",
      kind: "rate",
      ownerRole: "FINANCE",
      labelFr: "Frais test",
      labelEn: "Test fee",
    },
    update: {},
  });
  await setParam("psp.fee_rate.mock", "0.02");
  await setParam("fees.borne_by", "SELLER", store.id);
  await setParam("platform.legal_name", "DuoShop Test SARL");
  await setParam("platform.niu", "M000000000000T");
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  const orders = (
    await db.order.findMany({
      where: { buyerId: userId },
      select: { id: true },
    })
  ).map((o) => o.id);
  const payments = (
    await db.payment.findMany({
      where: { orderId: { in: orders } },
      select: { id: true },
    })
  ).map((p) => p.id);
  const sellerOrders = (
    await db.sellerOrder.findMany({ where: { tenantId }, select: { id: true } })
  ).map((s) => s.id);
  const refunds = (
    await db.refund.findMany({ where: { tenantId }, select: { id: true } })
  ).map((r) => r.id);
  const sources = [...sellerOrders, ...payments, ...refunds];
  const invoices = await db.commissionInvoice.findMany({
    where: { tenantId },
    select: { id: true, series: true, fiscalYear: true },
  });
  await db.commissionInvoiceLine.deleteMany({
    where: { invoiceId: { in: invoices.map((i) => i.id) } },
  });
  await db.commissionInvoice.deleteMany({ where: { tenantId } });
  // Compteurs : remis à la valeur suivant la plus haute facture restante (aucun trou créé).
  for (const { series, fiscalYear } of invoices) {
    const top = await db.commissionInvoice.aggregate({
      where: { series, fiscalYear },
      _max: { number: true },
    });
    await db.invoiceCounter.update({
      where: { series_fiscalYear: { series, fiscalYear } },
      data: { next: (top._max.number ?? 0) + 1 },
    });
  }
  await db.ledgerEntry.deleteMany({
    where: { journal: { sourceId: { in: sources } } },
  });
  await db.ledgerJournal.deleteMany({ where: { sourceId: { in: sources } } });
  await db.refund.deleteMany({ where: { tenantId } });
  await db.claimEvent.deleteMany({ where: { claim: { tenantId } } });
  await db.claimItem.deleteMany({ where: { tenantId } });
  await db.claim.deleteMany({ where: { tenantId } });
  await db.handoverCode.deleteMany({
    where: { sellerOrderId: { in: sellerOrders } },
  });
  await db.fulfilmentEvent.deleteMany({ where: { tenantId } });
  await db.notification.deleteMany({ where: { userId } });
  await db.outboxEvent.deleteMany({ where: { tenantId } });
  await db.providerEvent.deleteMany({ where: { paymentId: { in: payments } } });
  await db.payment.deleteMany({ where: { id: { in: payments } } });
  await db.stockMovement.deleteMany({ where: { tenantId } });
  await db.orderItem.deleteMany({ where: { tenantId } });
  await db.sellerOrder.deleteMany({ where: { tenantId } });
  await db.order.deleteMany({ where: { id: { in: orders } } });
  await db.cartItem.deleteMany({ where: { cart: { userId } } });
  await db.cart.deleteMany({ where: { userId } });
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.regulatoryParameter.deleteMany({
    where: { id: { in: ids.params } },
  });
  await db.regulatoryParameter.updateMany({
    where: { id: { in: ids.closed } },
    data: { effectiveTo: null },
  });
  await db.parameterDefinition.deleteMany({
    where: { key: "psp.fee_rate.mock" },
  });
  await db.ledgerAccountMapping.deleteMany({
    where: { createdBy: { in: ids.users } },
  });
  await db.configAudit.deleteMany({ where: { actorId: { in: ids.users } } });
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.commissionRule.deleteMany({ where: { id: ids.rule } });
  await db.paymentMethod.deleteMany({ where: { id: ids.method } });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("accounting and invoices", () => {
  test("provider fees are booked at collection, here charged to the seller", async () => {
    f.firstSo = await paidAndDelivered();
    // 2 % de 20 000 = 400, à la charge du vendeur (paramètre de la boutique).
    assert.deepEqual(await lines("psp_fee", f.firstSo), [
      { account: "PSP_CLEARING", amountMinor: -400n },
      { account: "SELLER_PAYABLE", amountMinor: 400n },
    ]);
    // Commission 10 % = 2 000 TVA comprise : 1 677 de revenu, 323 de TVA (19,25 %).
    assert.deepEqual(await lines("commission_earned", f.firstSo), [
      { account: "COMMISSION_DEFERRED", amountMinor: 2000n },
      { account: "COMMISSION_REVENUE", amountMinor: -1677n },
      { account: "VAT_COLLECTED", amountMinor: -323n },
    ]);
    // Les frais ne faussent pas le rapprochement des encaissements du jour.
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const report = await call(
      "GET",
      `/v1/admin/finance?from=${today}&to=${today}`,
      f.finance,
    );
    assert.equal(report.statusCode, 200, report.body);
    assert.ok(
      !report
        .json()
        .anomalies.some((a: { kind: string }) => a.kind === "daily_mismatch"),
      JSON.stringify(report.json().anomalies),
    );
  });

  test("with CLAIM_WINDOW_END, the commission is earned only once the claim window has passed", async () => {
    await setParam("commission.recognition", "CLAIM_WINDOW_END");
    f.lateSo = await paidAndDelivered();
    const so = await db.sellerOrder.findUniqueOrThrow({
      where: { id: f.lateSo },
    });
    assert.equal(so.commissionRecognition, "CLAIM_WINDOW_END");
    assert.deepEqual(await lines("commission_earned", f.lateSo), []);
    assert.equal(await recognizeDueCommissions(db), 0);
    await db.sellerOrder.update({
      where: { id: f.lateSo },
      data: { deliveredAt: new Date(Date.now() - 8 * 86400_000) },
    });
    assert.ok((await recognizeDueCommissions(db)) >= 1);
    assert.equal((await lines("commission_earned", f.lateSo)).length, 3);
    // Le premier paiement garde sa règle (HANDOVER) : jamais requalifié.
    const first = await db.sellerOrder.findUniqueOrThrow({
      where: { id: f.firstSo },
    });
    assert.equal(first.commissionRecognition, "HANDOVER");
  });

  test("invoices are numbered without gaps, issued once, and a later refund gives a credit note", async () => {
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const issue = async () =>
      (
        await db.$queryRaw<{ n: number }[]>`
        SELECT issue_commission_invoices(${today}::date, ${today}::date) AS n`
      )[0]?.n;
    assert.ok(((await issue()) ?? 0) >= 1);
    assert.equal(await issue(), 0);
    const invoice = await db.commissionInvoice.findFirstOrThrow({
      where: { storeId: f.storeId, kind: "INVOICE" },
      include: { lines: true },
    });
    assert.equal(invoice.lines.length, 2);
    assert.equal(invoice.totalTtcMinor, 4000n);
    assert.equal(invoice.vatMinor, 646n);
    assert.equal(invoice.totalHtMinor, 3354n);
    assert.equal((invoice.platform as { niu: string }).niu, "M000000000000T");
    // Numérotation : la série FC de l'exercice n'a aucun trou.
    const numbers = (
      await db.commissionInvoice.findMany({
        where: { series: "FC", fiscalYear: invoice.fiscalYear },
        select: { number: true },
        orderBy: { number: "asc" },
      })
    ).map((i) => i.number);
    assert.deepEqual(
      numbers,
      numbers.map((_, i) => i + 1),
    );

    // Réclamation acceptée après facturation : avoir de la commission reprise.
    const so = await db.sellerOrder.findUniqueOrThrow({
      where: { id: f.firstSo },
      include: { items: true },
    });
    const opened = await call(
      "POST",
      `/v1/orders/${so.orderId}/claims`,
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
    assert.equal(
      (
        await call(
          "POST",
          `/v1/stores/${f.storeId}/claims/${claim.id}/respond`,
          f.owner,
          {
            accept: true,
            expectedVersion: claim.version,
          },
        )
      ).statusCode,
      200,
    );
    assert.equal(await issue(), 1);
    const credit = await db.commissionInvoice.findFirstOrThrow({
      where: { storeId: f.storeId, kind: "CREDIT_NOTE" },
    });
    assert.equal(credit.series, "AV");
    assert.equal(credit.totalTtcMinor, 2000n);
    assert.equal(credit.vatMinor, 323n);

    // PDF, accès vendeur, paiement constaté par la finance seule.
    const pdf = await call(
      "GET",
      `/v1/stores/${f.storeId}/invoices/${invoice.id}/pdf`,
      f.owner,
    );
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), "%PDF-");
    const listed = await call(
      "GET",
      `/v1/stores/${f.storeId}/invoices`,
      f.owner,
    );
    assert.equal(listed.json().invoices.length, 2);
    assert.equal(
      (
        await call("POST", `/v1/admin/invoices/${invoice.id}/paid`, f.admin, {
          reference: "MOMO-123",
        })
      ).statusCode,
      403,
    );
    const paid = await call(
      "POST",
      `/v1/admin/invoices/${invoice.id}/paid`,
      f.finance,
      {
        reference: "MOMO-123",
      },
    );
    assert.equal(paid.statusCode, 200, paid.body);
    assert.equal(
      (
        await call("POST", `/v1/admin/invoices/${credit.id}/paid`, f.finance, {
          reference: "X-1",
        })
      ).json().error,
      "not_invoice",
    );
  });

  test("CSV exports for the accountant carry the SYSCOHADA mapping entered by finance", async () => {
    const mapped = await call("POST", "/v1/admin/ledger-mapping", f.finance, {
      account: "VAT_COLLECTED",
      accountNumber: "4431",
      label: "Libellé saisi par le test",
      effectiveFrom: "2026-01-01",
    });
    assert.equal(mapped.statusCode, 201, mapped.body);
    assert.equal(
      (
        await call("POST", "/v1/admin/ledger-mapping", f.admin, {
          account: "PSP_FEES",
          accountNumber: "631",
          label: "Test",
          effectiveFrom: "2026-01-01",
        })
      ).statusCode,
      403,
    );
    const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
    const balance = await call(
      "GET",
      `/v1/admin/exports/balance.csv?from=${today}&to=${today}`,
      f.finance,
    );
    assert.equal(balance.statusCode, 200);
    assert.match(balance.headers["content-type"] as string, /text\/csv/);
    const text = balance.body;
    assert.equal(text.charCodeAt(0), 0xfeff);
    assert.ok(
      text.includes(
        "compte_interne;compte_syscohada;intitule;debit;credit;solde",
      ),
    );
    assert.ok(text.includes("VAT_COLLECTED;4431;Libellé saisi par le test"));
    const vat = await call(
      "GET",
      `/v1/admin/exports/vat.csv?from=${today}&to=${today}`,
      f.finance,
    );
    assert.ok(
      vat.body
        .split("\r\n")
        .slice(1)
        .every((l) => !l || l.includes(";VAT_COLLECTED;")),
    );
    assert.equal(
      (
        await call(
          "GET",
          `/v1/admin/exports/ledger.csv?from=${today}&to=${today}`,
          f.admin,
        )
      ).statusCode,
      403,
    );
    assert.ok(
      (await db.configAudit.count({ where: { entity: "Export" } })) >= 2,
    );
  });
});
