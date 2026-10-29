import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { createDatabase } from "@duoshop/database";
import { MemoryStorage } from "@duoshop/media";
import sharp from "sharp";
import { processPendingMedia, UPLOAD_GRACE_MS } from "./media-job";

const db = createDatabase();
const storage = new MemoryStorage();
const tenants: string[] = [];
let tenantId = "";
let productId = "";

async function media(uploadKeySuffix: string, createdAt = new Date()) {
  return db.productMedia.create({
    data: {
      tenantId,
      productId,
      uploadKey: `quarantine/${tenantId}/${uploadKeySuffix}`,
      altFr: "Photo de test",
      altEn: "Test photo",
      createdAt,
    },
  });
}

before(async () => {
  const tenant = await db.tenant.create({
    data: { name: "TEST-WORKER-MEDIA", status: "ACTIVE" },
  });
  tenants.push(tenant.id);
  tenantId = tenant.id;
  const store = await db.store.create({
    data: { tenantId, slug: `test-${randomUUID()}`, name: "TEST" },
  });
  productId = (
    await db.product.create({
      data: { tenantId, storeId: store.id, title: "TEST" },
    })
  ).id;
});

after(async () => {
  await db.productMedia.deleteMany({ where: { tenantId: { in: tenants } } });
  await db.product.deleteMany({ where: { tenantId: { in: tenants } } });
  await db.store.deleteMany({ where: { tenantId: { in: tenants } } });
  await db.tenant.deleteMany({ where: { id: { in: tenants } } });
  await db.$disconnect();
});

test("the worker publishes clean images and rejects everything else", async () => {
  const good = await media("good");
  const disguised = await media("svg-as-jpeg");
  const late = await media("never-uploaded-recent");
  const abandoned = await media(
    "never-uploaded-old",
    new Date(Date.now() - UPLOAD_GRACE_MS - 60_000),
  );
  storage.quarantine.set(
    good.uploadKey,
    await sharp({
      create: { width: 1600, height: 900, channels: 3, background: "#12634f" },
    })
      .jpeg()
      .withExif({
        IFD0: { Model: "Secret device" },
        IFD3: { GPSLatitudeRef: "N" },
      })
      .toBuffer(),
  );
  storage.quarantine.set(
    disguised.uploadKey,
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    ),
  );

  const report = await processPendingMedia(db, storage);
  assert.deepEqual(report, { ready: 1, rejected: 2, waiting: 1 });

  const rows = new Map(
    (await db.productMedia.findMany({ where: { tenantId } })).map((m) => [
      m.id,
      m,
    ]),
  );
  const ready = rows.get(good.id);
  assert.equal(ready?.status, "READY");
  assert.equal(ready?.publicKey, `products/${tenantId}/${good.id}.webp`);
  assert.deepEqual([ready?.width, ready?.height], [1200, 675]);
  assert.equal(rows.get(disguised.id)?.rejectReason, "unsupported_type");
  assert.equal(rows.get(abandoned.id)?.rejectReason, "upload_missing");
  assert.equal(rows.get(late.id)?.status, "PENDING");

  const published = storage.published.get(
    `products/${tenantId}/${good.id}.webp`,
  );
  assert.equal(published?.contentType, "image/webp");
  const meta = await sharp(published?.data).metadata();
  assert.equal(meta.format, "webp");
  assert.equal(meta.exif, undefined);
  assert.equal(published?.data.includes(Buffer.from("Secret device")), false);
  // La quarantaine est vidée après traitement ; rien de dangereux n'est publié.
  assert.equal(storage.quarantine.size, 0);
  assert.equal(storage.published.size, 1);
});

test("a second run changes nothing", async () => {
  const before = storage.published.size;
  const report = await processPendingMedia(db, storage);
  assert.deepEqual(report, { ready: 0, rejected: 0, waiting: 1 });
  assert.equal(storage.published.size, before);
});
