import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import { MemoryVault } from "@duoshop/media";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

// Lot 5 (ADR 0013) : pièces chiffrées dans un coffre séparé, dossier par niveau, décision par une
// autre personne, consultation journalisée, plafond de ventes mensuel.
const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const vault = new MemoryVault();
const keys = { keys: new Map([[1, randomBytes(32)]]), currentVersion: 1 };
const app = await createApp({ db, webOrigin, kyc: { vault, keys } });
const ids = {
  tenants: [] as string[],
  users: [] as string[],
  params: [] as string[],
  closed: [] as string[],
};
const f = {
  tenantId: "",
  storeId: "",
  slug: "",
  variant: "",
  owner: { id: "", token: "" },
  compliance: "",
  compliance2: "",
  support: "",
  buyer: "",
  idCard: "",
};
// Faux fichiers : seuls les premiers octets comptent pour le contrôle du type.
const jpeg = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.from("PHOTO-CNI-SECRETE"),
]);
const pdf = Buffer.from("%PDF-1.4 attestation NIU");

async function user(platform?: "SUPPORT" | "COMPLIANCE") {
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
async function setParam(key: string, value: string) {
  const now = new Date();
  const open = await db.regulatoryParameter.findMany({
    where: { key, storeId: null, effectiveTo: null, approvedAt: { not: null } },
  });
  for (const p of open) {
    await db.regulatoryParameter.update({
      where: { id: p.id },
      data: { effectiveTo: now },
    });
    ids.closed.push(p.id);
  }
  ids.params.push(
    (
      await db.regulatoryParameter.create({
        data: {
          key,
          value,
          effectiveFrom: now,
          approvedAt: now,
          legalBasis: "Test automatisé",
        },
      })
    ).id,
  );
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
const upload = (
  type: string,
  body: Buffer,
  contentType: string,
  token = f.owner.token,
) =>
  app.inject({
    method: "POST",
    url: `/v1/stores/${f.storeId}/kyc/documents/${type}`,
    headers: {
      cookie: `${SESSION_COOKIE}=${token}`,
      origin: webOrigin,
      "content-type": contentType,
    },
    payload: body,
  });

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-kyc", status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Boutique KYC",
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
      title: "Sac KYC",
      status: "PUBLISHED",
      publishedAt: new Date(),
    },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `K-${randomUUID().slice(0, 8)}`,
      label: "Unique",
      priceMinor: 600000n,
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
    owner,
    compliance: (await user("COMPLIANCE")).token,
    compliance2: (await user("COMPLIANCE")).token,
    support: (await user("SUPPORT")).token,
    buyer: (await user()).token,
  });
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  await db.sensitiveAccessLog.deleteMany({
    where: { actorId: { in: ids.users } },
  });
  await db.configAudit.deleteMany({ where: { actorId: { in: ids.users } } });
  await db.kycDocument.deleteMany({ where: { tenantId } });
  await db.kycProfile.deleteMany({ where: { tenantId } });
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
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.regulatoryParameter.deleteMany({
    where: { id: { in: ids.params } },
  });
  await db.regulatoryParameter.updateMany({
    where: { id: { in: ids.closed } },
    data: { effectiveTo: null },
  });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("tiered seller KYC", () => {
  test("documents are checked by content, sealed in the vault and never stored in clear", async () => {
    const fake = await upload(
      "ID_CARD",
      Buffer.from("pas une image"),
      "image/jpeg",
    );
    assert.equal(fake.json().error, "invalid_file");
    const stranger = await user();
    assert.equal(
      (await upload("ID_CARD", jpeg, "image/jpeg", stranger.token)).statusCode,
      404,
    );
    const ok = await upload("ID_CARD", jpeg, "image/jpeg");
    assert.equal(ok.statusCode, 201, ok.body);
    f.idCard = ok.json().id;
    const row = await db.kycDocument.findUniqueOrThrow({
      where: { id: f.idCard },
    });
    const stored = vault.objects.get(row.objectKey);
    assert.ok(stored);
    assert.ok(!stored.includes(Buffer.from("PHOTO-CNI-SECRETE")));
    assert.ok(!Buffer.from(row.wrappedKey).equals(keys.keys.get(1) as Buffer));
    // Remplacement : l'ancienne pièce est marquée et programmée pour effacement.
    const again = await upload("ID_CARD", jpeg, "image/jpeg");
    const old = await db.kycDocument.findUniqueOrThrow({
      where: { id: f.idCard },
    });
    assert.ok(old.supersededAt && old.purgeAfter);
    assert.ok(old.purgeAfter.getTime() > Date.now() + 9 * 365 * 86400_000);
    f.idCard = again.json().id;
  });

  test("a tier is submitted only with its documents and reviewed by someone else", async () => {
    const submit = (tier: number, extra: object = {}) =>
      call("POST", `/v1/stores/${f.storeId}/kyc/submit`, f.owner.token, {
        tier,
        mobileMoneyNumber: "677 11 22 33",
        location: "Akwa, rue Joss",
        ...extra,
      });
    assert.equal((await submit(1)).json().error, "documents_missing");
    assert.equal((await upload("SELFIE", jpeg, "image/jpeg")).statusCode, 201);
    assert.equal((await submit(2)).json().error, "documents_missing");
    assert.equal((await submit(1)).statusCode, 200);
    // Une personne qui a déposé une pièce ne décide pas ; le support n'a pas ce droit.
    const ownerAsStaff = await db.platformMember.create({
      data: { userId: f.owner.id, role: "COMPLIANCE" },
    });
    await db.session.updateMany({
      where: { userId: f.owner.id },
      data: { mfa: true },
    });
    const self = await call(
      "POST",
      `/v1/admin/kyc/${f.storeId}/review`,
      f.owner.token,
      { approve: true },
    );
    assert.equal(self.json().error, "same_person");
    await db.platformMember.delete({ where: { userId: ownerAsStaff.userId } });
    assert.equal(
      (
        await call("POST", `/v1/admin/kyc/${f.storeId}/review`, f.support, {
          approve: true,
        })
      ).statusCode,
      403,
    );
    const queue = await call("GET", "/v1/admin/kyc", f.compliance);
    const item = queue
      .json()
      .queue.find((q: { storeId: string }) => q.storeId === f.storeId);
    assert.equal(item.mobileMoneyNumber, "••••••33");
    assert.equal(item.documents.length, 2);
    const noReason = await call(
      "POST",
      `/v1/admin/kyc/${f.storeId}/review`,
      f.compliance,
      { approve: false },
    );
    assert.equal(noReason.json().error, "reason_required");
    const approved = await call(
      "POST",
      `/v1/admin/kyc/${f.storeId}/review`,
      f.compliance,
      { approve: true },
    );
    assert.equal(approved.statusCode, 200, approved.body);
    const profile = await db.kycProfile.findUniqueOrThrow({
      where: { storeId: f.storeId },
    });
    assert.equal(profile.approvedTier, 1);
    assert.equal(profile.mobileMoneyNumber, "+237677112233");
  });

  test("viewing a document needs a reason and is logged", async () => {
    const view = (reason: string, token = f.compliance2) =>
      app.inject({
        method: "POST",
        url: `/v1/admin/kyc/documents/${f.idCard}/view`,
        headers: {
          cookie: `${SESSION_COOKIE}=${token}`,
          origin: webOrigin,
          "content-type": "application/x-www-form-urlencoded",
        },
        payload: new URLSearchParams({ reason }).toString(),
      });
    assert.equal((await view("voir")).json().error, "reason_required");
    assert.equal(
      (await view("Contrôle du dossier", f.support)).statusCode,
      403,
    );
    const shown = await view("Contrôle de cohérence du dossier");
    assert.equal(shown.statusCode, 200);
    assert.equal(shown.headers["content-type"], "image/jpeg");
    assert.equal(shown.headers["cache-control"], "private, no-store");
    assert.ok(shown.rawPayload.equals(jpeg));
    assert.equal(
      await db.sensitiveAccessLog.count({
        where: { resourceId: f.idCard, resource: "kyc_document" },
      }),
      1,
    );
  });

  test("monthly sales caps follow the approved tier once enforced", async () => {
    await setParam("kyc.enforce_caps", "true");
    await setParam("kyc.monthly_cap.tier1", "1000000");
    await call("POST", "/v1/cart/items", f.buyer, {
      variantId: f.variant,
      quantity: 1,
    });
    const first = await call("POST", "/v1/orders", f.buyer, {
      idempotencyKey: randomUUID().replaceAll("-", ""),
      deliveries: [{ storeSlug: f.slug, method: "PICKUP" }],
      expectedTotalMinor: "600000",
    });
    assert.equal(first.statusCode, 201, first.body);
    // 600 000 en attente + 600 000 > 1 000 000 : refusé.
    await call("POST", "/v1/cart/items", f.buyer, {
      variantId: f.variant,
      quantity: 1,
    });
    const second = await call("POST", "/v1/orders", f.buyer, {
      idempotencyKey: randomUUID().replaceAll("-", ""),
      deliveries: [{ storeSlug: f.slug, method: "PICKUP" }],
      expectedTotalMinor: "600000",
    });
    assert.equal(second.json().error, "seller_cap_reached");
  });
});
