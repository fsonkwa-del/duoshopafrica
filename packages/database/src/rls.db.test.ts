import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase } from "./client";
import { asRuntime, enterTenant } from "./scope";

// Un seul socket : prouve que le contexte d'une transaction ne survit pas au réemploi de connexion.
const db = createDatabase({ max: 1 });
const fixture = { tenantA: "", tenantB: "", storeA: "", storeB: "", userA: "" };

before(async () => {
  const [a, b] = await Promise.all([
    db.tenant.create({ data: { name: "TEST-RLS-A" } }),
    db.tenant.create({ data: { name: "TEST-RLS-B" } }),
  ]);
  const storeA = await db.store.create({
    data: { tenantId: a.id, slug: `test-${randomUUID()}`, name: "TEST A" },
  });
  const storeB = await db.store.create({
    data: { tenantId: b.id, slug: `test-${randomUUID()}`, name: "TEST B" },
  });
  const user = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  await db.storeMember.create({
    data: {
      tenantId: a.id,
      storeId: storeA.id,
      userId: user.id,
      role: "OWNER",
    },
  });
  Object.assign(fixture, {
    tenantA: a.id,
    tenantB: b.id,
    storeA: storeA.id,
    storeB: storeB.id,
    userA: user.id,
  });
});

after(async () => {
  const tenants = [fixture.tenantA, fixture.tenantB];
  await db.auditLog.deleteMany({ where: { tenantId: { in: tenants } } });
  await db.storeMember.deleteMany({ where: { tenantId: { in: tenants } } });
  await db.store.deleteMany({ where: { tenantId: { in: tenants } } });
  await db.tenant.deleteMany({ where: { id: { in: tenants } } });
  await db.user.deleteMany({ where: { id: fixture.userA } });
  await db.$disconnect();
});

describe("row level security for the runtime role", () => {
  test("denies every private row without context", async () => {
    // Seules les boutiques de vendeurs ACTIFS sont publiques (vitrine) ; les fixtures sont en attente.
    const seen = await asRuntime(db, {}, async (tx) => ({
      stores: await tx.store.count({
        where: { id: { in: [fixture.storeA, fixture.storeB] } },
      }),
      tenants: await tx.tenant.count(),
      members: await tx.storeMember.count(),
      users: await tx.user.count(),
    }));
    assert.deepEqual(seen, { stores: 0, tenants: 0, members: 0, users: 0 });
  });

  test("tenant A context never reads tenant B, even by guessed id", async () => {
    const [own, foreign, all] = await asRuntime(db, {}, async (tx) => {
      await enterTenant(tx, fixture.tenantA);
      return Promise.all([
        tx.store.findUnique({ where: { id: fixture.storeA } }),
        tx.store.findUnique({ where: { id: fixture.storeB } }),
        tx.store.findMany({ select: { tenantId: true } }),
      ]);
    });
    assert.equal(own?.id, fixture.storeA);
    assert.equal(foreign, null);
    // Seules s'y ajoutent les vitrines publiques (tenants actifs), lisibles sans aucun contexte.
    const publicTenants = new Set(
      (
        await asRuntime(db, {}, (tx) =>
          tx.store.findMany({ select: { tenantId: true } }),
        )
      ).map((s) => s.tenantId),
    );
    assert.ok(publicTenants.has(fixture.tenantB) === false);
    assert.ok(
      all.every(
        (store) =>
          store.tenantId === fixture.tenantA ||
          publicTenants.has(store.tenantId),
      ),
    );
  });

  test("user context resolves only its own memberships", async () => {
    const members = await asRuntime(db, { userId: fixture.userA }, (tx) =>
      tx.storeMember.findMany({ select: { userId: true, storeId: true } }),
    );
    assert.deepEqual(members, [
      { userId: fixture.userA, storeId: fixture.storeA },
    ]);
  });

  test("rejects an audit row written into another tenant", async () => {
    await assert.rejects(
      asRuntime(db, {}, async (tx) => {
        await enterTenant(tx, fixture.tenantA);
        await tx.auditLog.create({
          data: {
            tenantId: fixture.tenantB,
            actorId: fixture.userA,
            action: "test.cross_tenant",
            resourceId: fixture.storeB,
            requestId: "test",
          },
        });
      }),
      /row-level security|42501/i,
    );
  });

  test("runtime cannot rewrite or erase the audit trail", async () => {
    for (const statement of [
      `UPDATE "AuditLog" SET "action" = 'tampered'`,
      `DELETE FROM "AuditLog"`,
      `DELETE FROM "Store"`,
    ])
      await assert.rejects(
        asRuntime(db, {}, async (tx) => {
          await enterTenant(tx, fixture.tenantA);
          await tx.$executeRawUnsafe(statement);
        }),
        /permission denied|42501/i,
      );
  });

  test("context does not leak to the next transaction on a reused connection", async () => {
    await asRuntime(db, { userId: fixture.userA }, async (tx) => {
      await enterTenant(tx, fixture.tenantA);
      assert.equal(await tx.store.count({ where: { id: fixture.storeA } }), 1);
    });
    const after = await asRuntime(db, {}, async (tx) => ({
      stores: await tx.store.count({ where: { id: fixture.storeA } }),
      role: await tx.$queryRaw<{ role: string }[]>`SELECT current_user AS role`,
    }));
    assert.equal(after.stores, 0);
    assert.equal(after.role[0]?.role, "duoshop_app");
    const owner = await db.$queryRaw<{ role: string; tenant: string | null }[]>`
      SELECT current_user AS role, NULLIF(current_setting('app.tenant_id', true), '') AS tenant`;
    assert.notEqual(owner[0]?.role, "duoshop_app");
    assert.equal(owner[0]?.tenant, null);
  });
});
