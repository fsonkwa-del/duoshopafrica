import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase } from "./client";
import {
  adjustStock,
  releaseExpiredReservations,
  releaseReservation,
  reserveStock,
} from "./inventory";
import { asRuntime, enterTenant } from "./scope";

// Pool réel de 10 connexions : les 100 demandes se disputent vraiment les mêmes lignes.
const db = createDatabase({ max: 10 });
const tenants: string[] = [];
const actorId = randomUUID();

async function stockedVariant(onHand: number) {
  const tenant = await db.tenant.create({
    data: { name: "TEST-STOCK", status: "ACTIVE" },
  });
  tenants.push(tenant.id);
  const store = await db.store.create({
    data: { tenantId: tenant.id, slug: `test-${randomUUID()}`, name: "TEST" },
  });
  const product = await db.product.create({
    data: { tenantId: tenant.id, storeId: store.id, title: "TEST" },
  });
  const variant = await db.productVariant.create({
    data: {
      tenantId: tenant.id,
      productId: product.id,
      sku: `SKU-${randomUUID().slice(0, 8)}`,
      label: "Unique",
      priceMinor: 5000n,
      currency: "XAF",
    },
  });
  const location = await db.inventoryLocation.create({
    data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
  });
  await db.stockLevel.create({
    data: {
      tenantId: tenant.id,
      variantId: variant.id,
      locationId: location.id,
      onHand,
    },
  });
  return {
    tenantId: tenant.id,
    variantId: variant.id,
    locationId: location.id,
  };
}
const inTenant = <T>(
  tenantId: string,
  fn: Parameters<typeof asRuntime<T>>[2],
) =>
  asRuntime(db, {}, async (tx) => {
    await enterTenant(tx, tenantId);
    return fn(tx);
  });
const snapshot = ({
  variantId,
  locationId,
}: {
  variantId: string;
  locationId: string;
}) =>
  db.stockLevel.findUniqueOrThrow({
    where: { variantId_locationId: { variantId, locationId } },
    select: { onHand: true, reserved: true },
  });

before(async () => {
  await db.currency.upsert({
    where: { code: "XAF" },
    create: { code: "XAF", minorUnits: 0 },
    update: {},
  });
});

after(async () => {
  const tenantId = { in: tenants };
  await db.stockReservation.deleteMany({ where: { tenantId } });
  await db.stockMovement.deleteMany({ where: { tenantId } });
  await db.stockLevel.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.productVariant.deleteMany({ where: { tenantId } });
  await db.product.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.$disconnect();
});

describe("AC06 — stock never goes negative under concurrency", () => {
  test("100 simultaneous reservations on a stock of 10: exactly 10 succeed", async () => {
    const v = await stockedVariant(10);
    const results = await Promise.allSettled(
      Array.from({ length: 100 }, (_, i) =>
        inTenant(v.tenantId, (tx) =>
          reserveStock(tx, {
            ...v,
            quantity: 1,
            reference: `cart-${i}`,
            expiresAt: new Date(Date.now() + 900_000),
          }),
        ),
      ),
    );
    const outcomes = results.map((r) =>
      r.status === "fulfilled" ? r.value.status : "error",
    );
    assert.equal(outcomes.filter((s) => s === "reserved").length, 10);
    assert.equal(outcomes.filter((s) => s === "insufficient").length, 90);
    assert.equal(outcomes.filter((s) => s === "error").length, 0);
    assert.deepEqual(await snapshot(v), { onHand: 10, reserved: 10 });
    assert.equal(
      await db.stockReservation.count({
        where: { tenantId: v.tenantId, status: "ACTIVE" },
      }),
      10,
    );
  });

  test("50 simultaneous withdrawals of 1 on a stock of 10: exactly 10 apply", async () => {
    const v = await stockedVariant(10);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        inTenant(v.tenantId, (tx) =>
          adjustStock(tx, {
            ...v,
            delta: -1,
            reason: "ADJUSTMENT",
            note: null,
            actorId,
            idempotencyKey: `withdraw-${i}`,
          }),
        ),
      ),
    );
    assert.equal(results.filter((r) => r.status === "applied").length, 10);
    assert.equal(results.filter((r) => r.status === "insufficient").length, 40);
    assert.deepEqual(await snapshot(v), { onHand: 0, reserved: 0 });
    assert.equal(
      await db.stockMovement.count({ where: { tenantId: v.tenantId } }),
      10,
    );
  });

  test("physical stock cannot drop below what is reserved", async () => {
    const v = await stockedVariant(10);
    await inTenant(v.tenantId, (tx) =>
      reserveStock(tx, {
        ...v,
        quantity: 4,
        reference: "r1",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const outcome = await inTenant(v.tenantId, (tx) =>
      adjustStock(tx, {
        ...v,
        delta: -7,
        reason: "ADJUSTMENT",
        note: null,
        actorId,
        idempotencyKey: "too-much",
      }),
    );
    assert.equal(outcome.status, "insufficient");
    assert.deepEqual(await snapshot(v), { onHand: 10, reserved: 4 });
  });

  test("the database itself refuses a negative stock, even bypassing the service", async () => {
    const v = await stockedVariant(1);
    await assert.rejects(
      db.stockLevel.update({
        where: {
          variantId_locationId: {
            variantId: v.variantId,
            locationId: v.locationId,
          },
        },
        data: { onHand: -1 },
      }),
      /StockLevel_onHand_nonnegative|check constraint/i,
    );
  });
});

describe("idempotence and isolation", () => {
  test("a replayed stock receipt has no further effect; a reused key with another delta conflicts", async () => {
    const v = await stockedVariant(0);
    const receipt = {
      ...v,
      reason: "RECEIPT" as const,
      note: null,
      actorId,
      idempotencyKey: "rcpt-0001",
    };
    const first = await inTenant(v.tenantId, (tx) =>
      adjustStock(tx, { ...receipt, delta: 5 }),
    );
    const replay = await inTenant(v.tenantId, (tx) =>
      adjustStock(tx, { ...receipt, delta: 5 }),
    );
    const misuse = await inTenant(v.tenantId, (tx) =>
      adjustStock(tx, { ...receipt, delta: 9 }),
    );
    assert.deepEqual(
      [first.status, replay.status, misuse.status],
      ["applied", "replayed", "conflict"],
    );
    assert.deepEqual(await snapshot(v), { onHand: 5, reserved: 0 });
  });

  test("the same key sent twice at the same instant is applied once", async () => {
    const v = await stockedVariant(0);
    const receipt = {
      ...v,
      delta: 3,
      reason: "RECEIPT" as const,
      note: null,
      actorId,
      idempotencyKey: "rcpt-race",
    };
    const results = await Promise.allSettled([
      inTenant(v.tenantId, (tx) => adjustStock(tx, receipt)),
      inTenant(v.tenantId, (tx) => adjustStock(tx, receipt)),
    ]);
    // Le perdant est soit rejoué, soit annulé par la contrainte d'unicité : jamais appliqué deux fois.
    assert.ok(
      results.some(
        (r) => r.status === "fulfilled" && r.value.status === "applied",
      ),
    );
    assert.deepEqual(await snapshot(v), { onHand: 3, reserved: 0 });
  });

  test("a reservation reference is idempotent", async () => {
    const v = await stockedVariant(5);
    const request = {
      ...v,
      quantity: 2,
      reference: "order-42",
      expiresAt: new Date(Date.now() + 60_000),
    };
    const first = await inTenant(v.tenantId, (tx) => reserveStock(tx, request));
    const again = await inTenant(v.tenantId, (tx) => reserveStock(tx, request));
    assert.equal(first.status, "reserved");
    assert.equal(again.status, "replayed");
    assert.deepEqual(await snapshot(v), { onHand: 5, reserved: 2 });
  });

  test("another tenant cannot reserve or adjust this stock", async () => {
    const victim = await stockedVariant(5);
    const intruder = await stockedVariant(0);
    const reserve = await inTenant(intruder.tenantId, (tx) =>
      reserveStock(tx, {
        ...victim,
        tenantId: intruder.tenantId,
        quantity: 1,
        reference: "steal",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const adjust = await inTenant(intruder.tenantId, (tx) =>
      adjustStock(tx, {
        ...victim,
        tenantId: intruder.tenantId,
        delta: -5,
        reason: "ADJUSTMENT",
        note: null,
        actorId,
        idempotencyKey: "steal",
      }),
    );
    assert.equal(reserve.status, "insufficient");
    assert.equal(adjust.status, "not_found");
    assert.deepEqual(await snapshot(victim), { onHand: 5, reserved: 0 });
  });
});

describe("reservation lifecycle", () => {
  test("a release restores stock exactly once, even when raced", async () => {
    const v = await stockedVariant(3);
    await inTenant(v.tenantId, (tx) =>
      reserveStock(tx, {
        ...v,
        quantity: 3,
        reference: "cart-x",
        expiresAt: new Date(Date.now() + 60_000),
      }),
    );
    const released = await Promise.all(
      Array.from({ length: 5 }, () =>
        inTenant(v.tenantId, (tx) =>
          releaseReservation(tx, { tenantId: v.tenantId, reference: "cart-x" }),
        ),
      ),
    );
    assert.equal(released.filter(Boolean).length, 1);
    assert.deepEqual(await snapshot(v), { onHand: 3, reserved: 0 });
  });

  test("the worker releases expired reservations across tenants, and only those", async () => {
    const a = await stockedVariant(4);
    const b = await stockedVariant(4);
    const past = new Date(Date.now() - 1000);
    const future = new Date(Date.now() + 600_000);
    await inTenant(a.tenantId, (tx) =>
      reserveStock(tx, {
        ...a,
        quantity: 2,
        reference: "old",
        expiresAt: past,
      }),
    );
    await inTenant(b.tenantId, (tx) =>
      reserveStock(tx, {
        ...b,
        quantity: 1,
        reference: "old",
        expiresAt: past,
      }),
    );
    await inTenant(b.tenantId, (tx) =>
      reserveStock(tx, {
        ...b,
        quantity: 2,
        reference: "live",
        expiresAt: future,
      }),
    );
    assert.ok((await releaseExpiredReservations(db)) >= 2);
    assert.deepEqual(await snapshot(a), { onHand: 4, reserved: 0 });
    assert.deepEqual(await snapshot(b), { onHand: 4, reserved: 2 });
  });
});
