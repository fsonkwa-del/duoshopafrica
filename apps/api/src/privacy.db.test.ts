import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  applyRetention,
  createDatabase,
  issueSessionToken,
} from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

// Lot 2 (ADR 0010) : documents légaux, consentements, CGV à la commande, « Mes données »,
// demandes traitées par le personnel, anonymisation, consultation journalisée, conservation.
// Les documents publiés ici sont retirés en fin de suite : les autres suites n'en voient aucun.
const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const ids = {
  tenants: [] as string[],
  users: [] as string[],
  docs: [] as string[],
};
const f = {
  storeId: "",
  slug: "",
  variantId: "",
  buyer: { id: "", token: "" },
  support: "",
  compliance: "",
  admin: "",
  orderId: "",
  requestId: "",
};
type Role = "ADMIN" | "SUPPORT" | "COMPLIANCE";

async function user(platform?: Role) {
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
const publish = async (token: string, body: Record<string, unknown>) => {
  const res = await call("POST", "/v1/admin/legal-documents", token, {
    locale: "fr",
    title: "Texte de test",
    body: "Texte de test fourni pour les tests automatisés uniquement.",
    effectiveFrom: new Date().toISOString(),
    ...body,
  });
  if (res.statusCode === 201) ids.docs.push(res.json().id);
  return res;
};

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-privacy", status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Boutique Privacy",
      deliveryFeeMinor: 1000n,
    },
  });
  await db.merchantVerification.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      status: "APPROVED",
      legalName: "Ets Test",
      businessType: "INDIVIDUAL",
      ownerName: "Awa Ngono",
      ownerPhone: "+237699000111",
      city: "Douala",
      district: "Akwa",
    },
  });
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
  });
  const product = await db.product.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      title: "Savon noir",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `P-${randomUUID().slice(0, 8)}`,
      label: "Pain",
      priceMinor: 2000n,
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
  Object.assign(f, {
    storeId: store.id,
    slug: store.slug,
    variantId: variant.id,
    buyer: await user(),
    support: (await user("SUPPORT")).token,
    compliance: (await user("COMPLIANCE")).token,
    admin: (await user("ADMIN")).token,
  });
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  await db.legalDocument.deleteMany({ where: { id: { in: ids.docs } } });
  await db.configAudit.deleteMany({ where: { actorId: { in: ids.users } } });
  await db.sensitiveAccessLog.deleteMany({
    where: { actorId: { in: ids.users } },
  });
  await db.consent.deleteMany({ where: { userId } });
  await db.dataRequest.deleteMany({ where: { userId } });
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
  await db.merchantVerification.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("legal documents and consent", () => {
  test("only privacy staff publish; versions follow each other and never take effect in the past", async () => {
    assert.equal(
      (await publish(f.support, { kind: "CGU", version: 1 })).statusCode,
      403,
    );
    assert.equal(
      (await publish(f.compliance, { kind: "CGU", version: 2 })).json().error,
      "legal_version",
    );
    assert.equal(
      (
        await publish(f.compliance, {
          kind: "CGU",
          version: 1,
          effectiveFrom: new Date(Date.now() - 3600_000).toISOString(),
        })
      ).json().error,
      "legal_retroactive",
    );
    for (const kind of ["CGU", "PRIVACY", "CGV", "MARKETING"])
      assert.equal(
        (await publish(f.compliance, { kind, version: 1 })).statusCode,
        201,
      );
    const current = await app.inject({
      method: "GET",
      url: "/v1/legal/current?locale=en",
    });
    // Pas de version anglaise : le texte français est servi.
    assert.deepEqual(
      current
        .json()
        .documents.map((d: { kind: string; locale: string }) => [
          d.kind,
          d.locale,
        ]),
      [
        ["CGU", "fr"],
        ["CGV", "fr"],
        ["PRIVACY", "fr"],
        ["MARKETING", "fr"],
      ],
    );
  });

  test("a user must accept the terms and privacy policy before any change", async () => {
    // Le panier reste ouvert (visiteurs compris) ; une écriture du compte est bloquée.
    const blocked = await call("POST", "/v1/addresses", f.buyer.token, {
      label: "Maison",
      recipientName: "Paul Mbarga",
      phone: "677 00 11 22",
      city: "Douala",
      district: "Akwa",
      landmark: "Face à la boulangerie",
    });
    assert.equal(blocked.statusCode, 428);
    assert.equal(blocked.json().error, "consent_required");
    // Lire reste possible, comme accepter ou exercer ses droits.
    assert.equal(
      (await call("GET", "/v1/me/privacy", f.buyer.token)).json().pending
        .length,
      2,
    );
    for (const kind of ["CGU", "PRIVACY"])
      assert.equal(
        (
          await call("POST", "/v1/me/consents", f.buyer.token, {
            kind,
            version: 1,
            granted: true,
            source: "update",
          })
        ).statusCode,
        200,
      );
    const withdraw = await call("POST", "/v1/me/consents", f.buyer.token, {
      kind: "CGU",
      version: 1,
      granted: false,
      source: "account",
    });
    assert.equal(withdraw.json().error, "cannot_withdraw");
    assert.equal(
      (
        await call("POST", "/v1/me/consents", f.buyer.token, {
          kind: "CGU",
          version: 9,
          granted: true,
          source: "account",
        })
      ).statusCode,
      404,
    );
    // Marketing : facultatif, retirable ; chaque choix est une nouvelle ligne.
    for (const granted of [true, false])
      await call("POST", "/v1/me/consents", f.buyer.token, {
        kind: "MARKETING",
        version: 1,
        granted,
        source: "account",
      });
    const privacy = (await call("GET", "/v1/me/privacy", f.buyer.token)).json();
    assert.deepEqual(privacy.pending, []);
    assert.deepEqual(privacy.marketing, { version: 1, granted: false });
    assert.equal(
      await db.consent.count({
        where: { userId: f.buyer.id, kind: "MARKETING" },
      }),
      2,
    );
    assert.equal(
      (
        await call("POST", "/v1/cart/items", f.buyer.token, {
          variantId: f.variantId,
          quantity: 1,
        })
      ).statusCode,
      200,
    );
  });

  test("an order requires the CGV in force and keeps its version", async () => {
    const address = await call("POST", "/v1/addresses", f.buyer.token, {
      label: "Maison",
      recipientName: "Paul Mbarga",
      phone: "677 00 11 22",
      city: "Douala",
      district: "Akwa",
      landmark: "Face à la boulangerie",
    });
    assert.equal(address.statusCode, 201, address.body);
    const body = {
      idempotencyKey: randomUUID().replaceAll("-", ""),
      deliveries: [{ storeSlug: f.slug, method: "HOME_DELIVERY" }],
      addressId: address.json().id,
      expectedTotalMinor: "3000",
    };
    const refused = await call("POST", "/v1/orders", f.buyer.token, body);
    assert.equal(refused.json().error, "cgv_acceptance_required");
    const placed = await call("POST", "/v1/orders", f.buyer.token, {
      ...body,
      idempotencyKey: randomUUID().replaceAll("-", ""),
      cgvVersion: 1,
    });
    assert.equal(placed.statusCode, 201, placed.body);
    f.orderId = placed.json().id;
    const order = await db.order.findUniqueOrThrow({
      where: { id: f.orderId },
    });
    assert.equal(order.cgvVersion, 1);
    assert.equal(
      await db.consent.count({
        where: { userId: f.buyer.id, kind: "CGV", source: "checkout" },
      }),
      1,
    );
  });
});

describe("my data", () => {
  test("the export holds the person's own data, as JSON and PDF", async () => {
    const json = await call("GET", "/v1/me/export", f.buyer.token);
    assert.equal(json.statusCode, 200);
    assert.match(json.headers["content-disposition"] as string, /attachment/);
    assert.equal(json.headers["cache-control"], "private, no-store");
    const data = json.json();
    assert.equal(data.user.id, f.buyer.id);
    assert.equal(data.orders.length, 1);
    assert.ok(data.consents.length >= 5);
    const pdf = await call("GET", "/v1/me/export.pdf?lang=en", f.buyer.token);
    assert.equal(pdf.statusCode, 200);
    assert.equal(pdf.headers["content-type"], "application/pdf");
    assert.equal(pdf.rawPayload.subarray(0, 5).toString(), "%PDF-");
  });

  test("an erasure request is tracked, then executed only by privacy staff once nothing is pending", async () => {
    const opened = await call("POST", "/v1/me/data-requests", f.buyer.token, {
      kind: "ERASURE",
      message: "Je souhaite la suppression de mon compte.",
    });
    assert.equal(opened.statusCode, 201);
    f.requestId = opened.json().id;
    const row = await db.dataRequest.findUniqueOrThrow({
      where: { id: f.requestId },
    });
    // Échéance = délai de réponse paramétré (30 jours, à valider).
    const days = (row.dueAt.getTime() - row.createdAt.getTime()) / 86400_000;
    assert.ok(Math.abs(days - 30) < 0.01, `${days}`);

    const queue = await call("GET", "/v1/admin/data-requests", f.support);
    assert.equal(queue.json().canErase, false);
    assert.ok(
      queue.json().requests.some((r: { id: string }) => r.id === f.requestId),
    );
    const url = `/v1/admin/data-requests/${f.requestId}`;
    assert.equal(
      (await call("POST", url, f.support, { status: "IN_PROGRESS" }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await call("POST", url, f.support, {
          status: "DONE",
          resolution: "Compte supprimé à la main",
        })
      ).json().error,
      "use_erasure",
    );
    assert.equal(
      (
        await call("POST", `${url}/erase`, f.support, {
          resolution: "Demande vérifiée par le support.",
        })
      ).statusCode,
      403,
    );
    // Commande en attente de paiement : l'anonymisation attend.
    const blocked = await call("POST", `${url}/erase`, f.compliance, {
      resolution: "Demande vérifiée, identité confirmée.",
    });
    assert.equal(blocked.json().error, "blocked_activity");
    assert.equal(
      (await call("POST", `/v1/orders/${f.orderId}/cancel`, f.buyer.token))
        .statusCode,
      200,
    );
    const done = await call("POST", `${url}/erase`, f.compliance, {
      resolution: "Demande vérifiée, identité confirmée.",
    });
    assert.equal(done.statusCode, 200, done.body);
    const anonymised = await db.user.findUniqueOrThrow({
      where: { id: f.buyer.id },
    });
    assert.ok(anonymised.anonymizedAt);
    assert.match(anonymised.email, /@anonymized\.invalid$/);
    assert.equal(await db.session.count({ where: { userId: f.buyer.id } }), 0);
    const order = await db.order.findUniqueOrThrow({
      where: { id: f.orderId },
    });
    assert.deepEqual(order.addressSnapshot, {
      city: "Douala",
      district: "Akwa",
    });
    const address = await db.address.findFirstOrThrow({
      where: { userId: f.buyer.id },
    });
    assert.equal(address.recipientName, "-");
    // Les preuves restent : consentements et demande close.
    assert.ok((await db.consent.count({ where: { userId: f.buyer.id } })) >= 5);
    const closed = await db.dataRequest.findUniqueOrThrow({
      where: { id: f.requestId },
    });
    assert.equal(closed.status, "DONE");
    // Session supprimée : plus aucun accès.
    assert.equal(
      (await call("GET", "/v1/me/privacy", f.buyer.token)).statusCode,
      401,
    );
  });
});

describe("sensitive access", () => {
  test("the owner's private phone is masked in the queue and revealed only with a logged reason", async () => {
    const url = `/v1/admin/stores/${f.storeId}/owner-contact`;
    const short = await call("POST", url, f.support, { reason: "voir" });
    assert.equal(short.json().error, "reason_required");
    const shown = await call("POST", url, f.support, {
      reason: "Rappel du vendeur pour un litige en cours",
    });
    assert.equal(shown.statusCode, 200, shown.body);
    assert.deepEqual(shown.json(), {
      ownerName: "Awa Ngono",
      ownerPhone: "+237699000111",
    });
    const log = await call("GET", "/v1/admin/access-log", f.compliance);
    assert.ok(
      log
        .json()
        .entries.some(
          (e: { resourceId: string; reason: string }) =>
            e.resourceId === f.storeId &&
            e.reason === "Rappel du vendeur pour un litige en cours",
        ),
    );
    assert.equal(
      (await call("GET", "/v1/admin/access-log", f.support)).statusCode,
      403,
    );
  });

  test("retention runs dry by default and changes nothing", async () => {
    const before = await db.notification.count();
    const result = await applyRetention(db);
    assert.equal(result.mode, "DRY_RUN");
    assert.deepEqual(
      result.rules.map((r) => r.rule),
      ["notifications", "sessions", "inactive_accounts"],
    );
    assert.equal(await db.notification.count(), before);
  });
});
