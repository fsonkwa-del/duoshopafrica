import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  completeMedia,
  createDatabase,
  issueSessionToken,
} from "@duoshop/database";
import { MemoryStorage } from "@duoshop/media";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";
import { MAX_MEDIA_PER_PRODUCT } from "./media";

const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const storage = new MemoryStorage();
const mediaBaseUrl = "https://cdn.example.invalid/media";
const app = await createApp({ db, webOrigin, storage, mediaBaseUrl });
const withoutStorage = await createApp({ db, webOrigin });
const ids = { tenants: [] as string[], users: [] as string[] };
const f = { storeA: "", storeB: "", productA: "", owner: "", rival: "" };

async function sellerWithProduct() {
  const tenant = await db.tenant.create({
    data: { name: "TEST-MEDIA", status: "ACTIVE" },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "Atelier photo",
    },
  });
  const product = await db.product.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      title: "Panier tressé",
      status: "PUBLISHED",
    },
  });
  await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `M-${randomUUID().slice(0, 8)}`,
      label: "Unique",
      priceMinor: 4500n,
      currency: "XAF",
    },
  });
  const user = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(user.id);
  await db.storeMember.create({
    data: {
      tenantId: tenant.id,
      storeId: store.id,
      userId: user.id,
      role: "OWNER",
    },
  });
  const { token, tokenHash } = issueSessionToken();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return { storeId: store.id, productId: product.id, token };
}
const request = (
  target: typeof app,
  token: string,
  storeId: string,
  productId: string,
  payload: object,
) =>
  target.inject({
    method: "POST",
    url: `/v1/stores/${storeId}/products/${productId}/media`,
    headers: { cookie: `${SESSION_COOKIE}=${token}`, origin: webOrigin },
    payload,
  });
const photo = {
  contentType: "image/jpeg",
  bytes: 240_000,
  altFr: "Panier tressé en raphia naturel",
  altEn: "Natural raffia woven basket",
};

before(async () => {
  const a = await sellerWithProduct();
  const b = await sellerWithProduct();
  Object.assign(f, {
    storeA: a.storeId,
    storeB: b.storeId,
    productA: a.productId,
    owner: a.token,
    rival: b.token,
  });
});

after(async () => {
  await Promise.all([app.close(), withoutStorage.close()]);
  const tenantId = { in: ids.tenants };
  await db.productMedia.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.session.deleteMany({ where: { userId: { in: ids.users } } });
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
  await db.$disconnect();
});

describe("photo upload requests (ADR 0006)", () => {
  test("returns a short-lived signed upload into quarantine, with a server-chosen key", async () => {
    const response = await request(app, f.owner, f.storeA, f.productA, photo);
    assert.equal(response.statusCode, 201);
    const { mediaId, upload } = response.json();
    assert.equal(upload.method, "PUT");
    assert.deepEqual(upload.headers, {
      "content-type": "image/jpeg",
      "content-length": "240000",
    });
    assert.ok(Date.parse(upload.expiresAt) - Date.now() <= 300_000);
    const row = await db.productMedia.findUniqueOrThrow({
      where: { id: mediaId },
    });
    assert.equal(row.status, "PENDING");
    assert.match(
      row.uploadKey,
      new RegExp(`^quarantine/${row.tenantId}/${mediaId}$`),
    );
  });

  test("refuses unsafe types, oversized files and missing alternative text", async () => {
    for (const payload of [
      { ...photo, contentType: "image/svg+xml" },
      { ...photo, contentType: "image/gif" },
      { ...photo, bytes: 5 * 1024 * 1024 + 1 },
      { ...photo, altEn: "" },
      { contentType: "image/png", bytes: 10, altFr: "Photo du produit" },
      { ...photo, filename: "../../etc/passwd" },
    ])
      assert.equal(
        (await request(app, f.owner, f.storeA, f.productA, payload)).statusCode,
        400,
        JSON.stringify(payload),
      );
  });

  test("another seller cannot attach photos to this product", async () => {
    assert.equal(
      (await request(app, f.rival, f.storeA, f.productA, photo)).statusCode,
      404,
    );
    assert.equal(
      (await request(app, f.rival, f.storeB, f.productA, photo)).statusCode,
      404,
    );
  });

  test("caps photos per product", async () => {
    for (let i = 1; i < MAX_MEDIA_PER_PRODUCT; i++)
      assert.equal(
        (await request(app, f.owner, f.storeA, f.productA, photo)).statusCode,
        201,
      );
    const extra = await request(app, f.owner, f.storeA, f.productA, photo);
    assert.equal(extra.statusCode, 409);
    assert.deepEqual(extra.json(), { error: "media_limit" });
  });

  test("says so explicitly when no storage is configured", async () => {
    const response = await request(
      withoutStorage,
      f.owner,
      f.storeA,
      f.productA,
      photo,
    );
    assert.equal(response.statusCode, 503);
    assert.deepEqual(response.json(), {
      error: "media_storage_not_configured",
    });
  });
});

describe("photos in the storefront", () => {
  test("only processed photos are shown, with their localised alternative text", async () => {
    const [ready, rejected] = await db.productMedia.findMany({
      where: { productId: f.productA },
      orderBy: { position: "asc" },
      take: 2,
    });
    assert.ok(ready && rejected);
    assert.ok(
      await completeMedia(db, {
        id: ready.id,
        status: "READY",
        publicKey: `products/x/${ready.id}.webp`,
        width: 800,
        height: 800,
        bytes: 51_000,
      }),
    );
    assert.ok(
      await completeMedia(db, {
        id: rejected.id,
        status: "REJECTED",
        reason: "unsupported_type",
      }),
    );
    // Une photo déjà finalisée ne peut pas être réécrite (finalisation seulement depuis PENDING).
    assert.equal(
      await completeMedia(db, {
        id: rejected.id,
        status: "REJECTED",
        reason: "again",
      }),
      false,
    );
    const fr = (
      await app.inject(`/v1/catalog/products/${f.productA}?lang=fr`)
    ).json();
    const en = (
      await app.inject(`/v1/catalog/products/${f.productA}?lang=en`)
    ).json();
    assert.deepEqual(fr.media, [
      {
        url: `${mediaBaseUrl}/products/x/${ready.id}.webp`,
        alt: "Panier tressé en raphia naturel",
        width: 800,
        height: 800,
      },
    ]);
    assert.equal(en.media[0].alt, "Natural raffia woven basket");
    const listing = await app.inject("/v1/catalog/products?q=panier%20tresse");
    const card = listing
      .json()
      .items.find((i: { id: string }) => i.id === f.productA);
    assert.equal(
      card?.image?.url,
      `${mediaBaseUrl}/products/x/${ready.id}.webp`,
    );
  });
});
