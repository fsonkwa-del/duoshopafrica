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
  await db.auditLog.deleteMany({ where: { tenantId } });
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

describe("sellers manage their photos", () => {
  const act = (
    token: string,
    storeId: string,
    productId: string,
    mediaId: string,
    action: "remove" | "primary",
    origin = webOrigin,
  ) =>
    app.inject({
      method: "POST",
      url: `/v1/stores/${storeId}/products/${productId}/media/${mediaId}/${action}`,
      headers: { cookie: `${SESSION_COOKIE}=${token}`, origin },
      payload: {},
    });
  async function threePhotos() {
    const seller = await sellerWithProduct();
    const media: string[] = [];
    for (let i = 0; i < 3; i++) {
      const created = await request(
        app,
        seller.token,
        seller.storeId,
        seller.productId,
        photo,
      );
      media.push(created.json().mediaId);
    }
    for (const id of media.slice(0, 2))
      await completeMedia(db, {
        id,
        status: "READY",
        publicKey: `products/x/${id}.webp`,
        width: 800,
        height: 800,
        bytes: 51_000,
      });
    return { ...seller, media };
  }
  const order = async (productId: string) =>
    (
      await db.productMedia.findMany({
        where: { productId },
        orderBy: { position: "asc" },
        select: { id: true, position: true },
      })
    ).map((m) => [m.id, m.position]);

  test("a published photo becomes the main one, others follow without gaps", async () => {
    const s = await threePhotos();
    const [first, second, third] = s.media as [string, string, string];
    const done = await act(s.token, s.storeId, s.productId, second, "primary");
    assert.equal(done.statusCode, 200);
    assert.deepEqual(await order(s.productId), [
      [second, 0],
      [first, 1],
      [third, 2],
    ]);
    const shown = (
      await app.inject(`/v1/catalog/products/${s.productId}?lang=fr`)
    ).json();
    assert.equal(
      shown.media[0].url,
      `${mediaBaseUrl}/products/x/${second}.webp`,
    );
    // Une photo encore en vérification ne peut pas devenir principale.
    const pending = await act(
      s.token,
      s.storeId,
      s.productId,
      third,
      "primary",
    );
    assert.equal(pending.statusCode, 409);
    assert.deepEqual(pending.json(), { error: "media_not_ready" });
    const audit = await db.auditLog.count({
      where: { resourceId: s.productId, action: "catalog.media.primary" },
    });
    assert.equal(audit, 1);
  });

  test("removing a photo renumbers the rest; a photo being checked stays", async () => {
    const s = await threePhotos();
    const [first, second, third] = s.media as [string, string, string];
    assert.equal(
      (await act(s.token, s.storeId, s.productId, first, "remove")).statusCode,
      200,
    );
    assert.deepEqual(await order(s.productId), [
      [second, 0],
      [third, 1],
    ]);
    const pending = await act(s.token, s.storeId, s.productId, third, "remove");
    assert.equal(pending.statusCode, 409);
    assert.deepEqual(pending.json(), { error: "media_processing" });
    const listed = (
      await app.inject({
        url: `/v1/stores/${s.storeId}/products`,
        headers: { cookie: `${SESSION_COOKIE}=${s.token}` },
      })
    ).json();
    const product = listed.products.find(
      (p: { id: string }) => p.id === s.productId,
    );
    assert.equal(
      product.media[0].url,
      `${mediaBaseUrl}/products/x/${second}.webp`,
    );
    assert.equal(product.media[1].url, null);
  });

  test("only the store's own sellers, from the shop's origin, can change photos", async () => {
    const s = await threePhotos();
    const target = s.media[0] as string;
    assert.equal(
      (await act(f.rival, s.storeId, s.productId, target, "remove")).statusCode,
      404,
    );
    assert.equal(
      (await act(f.rival, f.storeB, s.productId, target, "remove")).statusCode,
      404,
    );
    // Un produit d'une autre boutique ne permet pas d'atteindre cette photo.
    assert.equal(
      (await act(f.owner, f.storeA, f.productA, target, "remove")).statusCode,
      404,
    );
    assert.equal(
      (
        await act(
          s.token,
          s.storeId,
          s.productId,
          target,
          "remove",
          "https://evil.example",
        )
      ).statusCode,
      403,
    );
    assert.equal((await order(s.productId)).length, 3);
  });
});
