import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

const db = createDatabase({ max: 4 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const ids = { tenants: [] as string[], users: [] as string[] };
const store = { p: "", q: "" };
const as = {
  owner: "",
  manager: "",
  otherOwner: "",
  admin: "",
  admin2: "",
  adminNoMfa: "",
  support: "",
  stranger: "",
  ownerAdmin: "",
};

async function user(
  options: { mfa?: boolean; platform?: "ADMIN" | "SUPPORT" } = {},
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
      mfa: options.mfa ?? false,
      expiresAt: new Date(Date.now() + 3600_000),
    },
  });
  return { id: created.id, token };
}
async function pendingStore() {
  const tenant = await db.tenant.create({ data: { name: "TEST-B02" } });
  ids.tenants.push(tenant.id);
  return db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: "TEST B02",
    },
  });
}
async function join(
  userId: string,
  target: { id: string; tenantId: string },
  role: "OWNER" | "MANAGER",
) {
  await db.storeMember.create({
    data: { tenantId: target.tenantId, storeId: target.id, userId, role },
  });
}
const headers = (token: string, origin: string | null = webOrigin) => ({
  cookie: `${SESSION_COOKIE}=${token}`,
  ...(origin ? { origin } : {}),
});
const declaration = {
  businessType: "COMPANY",
  ownerName: "Awa Ngono",
  ownerPhone: "6 77 12 34 56",
  city: "Douala",
  district: "Akwa",
  legalName: "Awa Commerce SARL",
  registrationNumber: "RC/DLA/2026/B/123",
};
const submit = (
  token: string,
  storeId: string,
  payload: object = declaration,
  origin: string | null = webOrigin,
) =>
  app.inject({
    method: "POST",
    url: `/v1/stores/${storeId}/verification`,
    headers: headers(token, origin),
    payload,
  });
const decide = (
  token: string,
  storeId: string,
  decision: string,
  expectedVersion: number,
  reason = "Pièces cohérentes et activité vérifiée.",
) =>
  app.inject({
    method: "POST",
    url: `/v1/admin/verifications/${storeId}/decision`,
    headers: headers(token),
    payload: { decision, reason, expectedVersion },
  });
const get = (token: string, url: string) =>
  app.inject({ method: "GET", url, headers: headers(token, null) });
const verification = (storeId: string) =>
  db.merchantVerification.findUniqueOrThrow({ where: { storeId } });
const tenantOf = async (storeId: string) =>
  (
    await db.store.findUniqueOrThrow({
      where: { id: storeId },
      select: { tenant: { select: { status: true } } },
    })
  ).tenant.status;

before(async () => {
  const p = await pendingStore();
  const q = await pendingStore();
  store.p = p.id;
  store.q = q.id;
  const owner = await user();
  const manager = await user();
  const otherOwner = await user();
  const ownerAdmin = await user({ mfa: true, platform: "ADMIN" });
  await join(owner.id, p, "OWNER");
  await join(manager.id, p, "MANAGER");
  await join(otherOwner.id, q, "OWNER");
  await join(ownerAdmin.id, q, "MANAGER");
  Object.assign(as, {
    owner: owner.token,
    manager: manager.token,
    otherOwner: otherOwner.token,
    ownerAdmin: ownerAdmin.token,
    admin: (await user({ mfa: true, platform: "ADMIN" })).token,
    admin2: (await user({ mfa: true, platform: "ADMIN" })).token,
    adminNoMfa: (await user({ mfa: false, platform: "ADMIN" })).token,
    support: (await user({ mfa: true, platform: "SUPPORT" })).token,
    stranger: (await user({ mfa: true })).token,
  });
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  const userId = { in: ids.users };
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.merchantVerification.deleteMany({ where: { tenantId } });
  await db.inventoryLocation.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.platformMember.deleteMany({ where: { userId } });
  await db.session.deleteMany({ where: { userId } });
  await db.user.deleteMany({ where: { id: userId } });
  await db.$disconnect();
});

describe("seller submits a verification request", () => {
  test("requires the site origin", async () => {
    assert.equal(
      (await submit(as.owner, store.p, undefined, null)).statusCode,
      403,
    );
  });

  test("only the owner of that store may submit", async () => {
    assert.equal((await submit(as.manager, store.p)).statusCode, 403);
    assert.equal((await submit(as.otherOwner, store.p)).statusCode, 404);
  });

  test("rejects malformed declarations", async () => {
    for (const payload of [
      { ...declaration, legalName: "A" },
      { ...declaration, registrationNumber: "<script>" },
      { ...declaration, extra: true },
      { ...declaration, businessType: "NGO" },
      { ...declaration, ownerName: "   " },
      { ...declaration, district: undefined },
      { legalName: "Awa Commerce" },
    ])
      assert.equal((await submit(as.owner, store.p, payload)).statusCode, 400);
    const phone = await submit(as.owner, store.p, {
      ...declaration,
      ownerPhone: "+33 6 12 34 56 78",
    });
    assert.equal(phone.statusCode, 400);
    assert.deepEqual(phone.json(), { error: "invalid_phone" });
  });

  test("submits once, is audited and visible to the owner", async () => {
    assert.equal((await submit(as.owner, store.p)).statusCode, 200);
    assert.equal((await submit(as.owner, store.p)).statusCode, 409);
    const view = (await get(as.owner, `/v1/stores/${store.p}`)).json();
    assert.deepEqual(view.verification, { status: "SUBMITTED", reason: null });
    assert.equal(
      await db.auditLog.count({
        where: { resourceId: store.p, action: "merchant.submit" },
      }),
      1,
    );
  });
});

describe("platform review queue", () => {
  test("hides the admin surface from non-staff and requires MFA", async () => {
    assert.equal(
      (await get(as.stranger, "/v1/admin/verifications")).statusCode,
      404,
    );
    const noMfa = await get(as.adminNoMfa, "/v1/admin/verifications");
    assert.equal(noMfa.statusCode, 403);
    assert.deepEqual(noMfa.json(), { error: "mfa_required" });
  });

  test("support reads submissions across tenants", async () => {
    const response = await get(as.support, "/v1/admin/verifications");
    assert.equal(response.statusCode, 200);
    const item = response
      .json()
      .items.find((i: { storeId: string }) => i.storeId === store.p);
    assert.equal(item?.legalName, "Awa Commerce SARL");
    // Téléphone enregistré sous sa forme internationale ; propriétaire visible pour l'examen.
    assert.equal(item?.ownerPhone, "+237677123456");
    assert.equal(item?.ownerName, "Awa Ngono");
    assert.equal(item?.businessType, "COMPANY");
    assert.equal(`${item?.district}, ${item?.city}`, "Akwa, Douala");
    assert.equal(item?.version, 0);
  });

  test("support can never decide", async () => {
    const response = await decide(as.support, store.p, "APPROVE", 0);
    assert.equal(response.statusCode, 403);
    assert.equal((await verification(store.p)).status, "SUBMITTED");
  });

  test("a decision needs a reason and the current version", async () => {
    const short = await decide(as.admin, store.p, "APPROVE", 0, "ok");
    assert.equal(short.statusCode, 400);
    assert.equal(short.json().error, "invalid_request");
    assert.equal(
      (await decide(as.admin, store.p, "APPROVE", 7)).statusCode,
      409,
    );
    assert.equal(
      (await decide(as.admin, store.p, "SUSPEND", 0)).statusCode,
      409,
    );
  });
});

describe("approval decision", () => {
  test("a failure inside the transaction leaves nothing half-done", async () => {
    await db.$executeRawUnsafe(`REVOKE INSERT ON "AuditLog" FROM duoshop_app`);
    try {
      const response = await decide(as.admin, store.p, "APPROVE", 0);
      assert.equal(response.statusCode, 500);
      // Aucun détail interne (SQL, droits) ne sort de l'API.
      assert.equal(response.json().error, "request_failed");
      assert.doesNotMatch(response.body, /permission|AuditLog|duoshop_app/i);
    } finally {
      await db.$executeRawUnsafe(`GRANT INSERT ON "AuditLog" TO duoshop_app`);
    }
    const row = await verification(store.p);
    assert.equal(row.status, "SUBMITTED");
    assert.equal(row.version, 0);
    assert.equal(await tenantOf(store.p), "PENDING");
  });

  test("two admins deciding at once: exactly one wins", async () => {
    const results = await Promise.all([
      decide(as.admin, store.p, "APPROVE", 0),
      decide(as.admin2, store.p, "APPROVE", 0),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    assert.deepEqual(codes, [200, 409]);
    const row = await verification(store.p);
    assert.equal(row.status, "APPROVED");
    assert.equal(row.version, 1);
    assert.equal(await tenantOf(store.p), "ACTIVE");
    assert.equal(
      await db.auditLog.count({
        where: { resourceId: store.p, action: "merchant.approve" },
      }),
      1,
    );
  });

  test("the owner sees an approved store without internal notes", async () => {
    const view = (await get(as.owner, `/v1/stores/${store.p}`)).json();
    assert.equal(view.tenantStatus, "ACTIVE");
    assert.deepEqual(view.verification, { status: "APPROVED", reason: null });
  });

  test("support consults the audit trail of the decision", async () => {
    const response = await get(as.support, `/v1/admin/stores/${store.p}/audit`);
    assert.equal(response.statusCode, 200);
    const [latest, ...older] = response.json().entries;
    assert.equal(latest.action, "merchant.approve");
    assert.equal(
      latest.detail.reason,
      "Pièces cohérentes et activité vérifiée.",
    );
    assert.equal(latest.detail.actorRole, "ADMIN");
    assert.deepEqual(
      [latest.detail.from, latest.detail.to],
      ["SUBMITTED", "APPROVED"],
    );
    assert.ok(
      older.some((e: { action: string }) => e.action === "merchant.submit"),
    );
  });
});

describe("rejection, conflict of interest and suspension", () => {
  test("an admin never decides on a store they belong to", async () => {
    assert.equal((await submit(as.otherOwner, store.q)).statusCode, 200);
    const response = await decide(as.ownerAdmin, store.q, "APPROVE", 0);
    assert.equal(response.statusCode, 403);
    assert.deepEqual(response.json(), { error: "conflict_of_interest" });
  });

  test("a rejection is explained to the seller, who may resubmit", async () => {
    const reason = "Numéro RCCM illisible, merci de le corriger.";
    assert.equal(
      (await decide(as.admin, store.q, "REJECT", 0, reason)).statusCode,
      200,
    );
    const view = (await get(as.otherOwner, `/v1/stores/${store.q}`)).json();
    assert.deepEqual(view.verification, { status: "REJECTED", reason });
    assert.equal(view.tenantStatus, "PENDING");
    assert.equal((await submit(as.otherOwner, store.q)).statusCode, 200);
    assert.equal((await verification(store.q)).status, "SUBMITTED");
  });

  test("a suspended seller is blocked", async () => {
    const reason = "Signalements répétés de contrefaçon en cours d'analyse.";
    assert.equal(
      (await decide(as.admin, store.p, "SUSPEND", 1, reason)).statusCode,
      200,
    );
    assert.equal(await tenantOf(store.p), "SUSPENDED");
    assert.equal(
      (await get(as.owner, `/v1/stores/${store.p}`)).statusCode,
      403,
    );
    assert.equal((await submit(as.owner, store.p)).statusCode, 403);
  });

  test("a reinstated seller regains access, with the reason on record", async () => {
    const reason = "Analyse close : signalements non fondés, accès rétabli.";
    assert.equal(
      (await decide(as.admin, store.p, "REINSTATE", 2, reason)).statusCode,
      200,
    );
    assert.equal(await tenantOf(store.p), "ACTIVE");
    assert.equal(
      (await get(as.owner, `/v1/stores/${store.p}`)).statusCode,
      200,
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { resourceId: store.p, action: "merchant.reinstate" },
    });
    assert.equal((audit.detail as { reason: string }).reason, reason);
  });
});

describe("a signed-in user opens a store", () => {
  const open = (
    token: string,
    payload: object,
    origin: string | null = webOrigin,
  ) =>
    app.inject({
      method: "POST",
      url: "/v1/stores",
      headers: headers(token, origin),
      payload,
    });
  const slug = () => `test-${randomUUID().slice(0, 8)}`;
  async function track(storeId: string) {
    const created = await db.store.findUniqueOrThrow({
      where: { id: storeId },
    });
    ids.tenants.push(created.tenantId);
    return created;
  }

  test("requires the site origin and a session", async () => {
    const u = await user();
    assert.equal(
      (await open(u.token, { name: "Awa", slug: slug() }, null)).statusCode,
      403,
    );
    const anonymous = await app.inject({
      method: "POST",
      url: "/v1/stores",
      headers: { origin: webOrigin },
      payload: { name: "Awa", slug: slug() },
    });
    assert.equal(anonymous.statusCode, 401);
  });

  test("creates a pending store owned by the user, ready to be verified", async () => {
    const u = await user();
    const address = slug();
    const res = await open(u.token, {
      name: "  Pagnes d'Awa ",
      slug: address.toUpperCase(),
    });
    assert.equal(res.statusCode, 201);
    const created = await track(res.json().id);
    assert.equal(created.slug, address);
    assert.equal(created.name, "Pagnes d'Awa");
    const tenant = await db.tenant.findUniqueOrThrow({
      where: { id: created.tenantId },
    });
    assert.equal(tenant.status, "PENDING");
    const member = await db.storeMember.findFirstOrThrow({
      where: { storeId: created.id },
    });
    assert.equal(member.userId, u.id);
    assert.equal(member.role, "OWNER");
    assert.equal(
      await db.inventoryLocation.count({ where: { storeId: created.id } }),
      1,
    );
    const audit = await db.auditLog.findFirstOrThrow({
      where: { resourceId: created.id, action: "store.open" },
    });
    assert.equal(audit.actorId, u.id);
    const me = await app.inject({
      method: "GET",
      url: "/v1/me",
      headers: headers(u.token),
    });
    assert.deepEqual(
      me.json().stores.map((s: { id: string; role: string }) => [s.id, s.role]),
      [[created.id, "OWNER"]],
    );
    // Étape suivante du parcours : la demande de vérification.
    assert.equal((await submit(u.token, created.id)).statusCode, 200);
  });

  test("refuses malformed or reserved addresses", async () => {
    const u = await user();
    for (const bad of ["ab", "a!", "!!!", "demo-shop", "Démo Shop", "--"])
      assert.equal(
        (await open(u.token, { name: "Awa", slug: bad })).statusCode,
        400,
        bad,
      );
    assert.equal(
      (await open(u.token, { name: "A", slug: slug() })).statusCode,
      400,
    );
  });

  test("a free-form address is stored in its canonical form", async () => {
    const u = await user();
    const id = randomUUID().slice(0, 8);
    const response = await open(u.token, {
      name: "iNova Tech 2",
      slug: `Test Élan ${id}`,
    });
    assert.equal(response.statusCode, 201);
    const created = await track(response.json().id);
    assert.equal(created.slug, `test-elan-${id}`);
  });

  test("an address belongs to one store, even under concurrent requests", async () => {
    const [a, b] = [await user(), await user()];
    const address = slug();
    const results = await Promise.all([
      open(a.token, { name: "Awa", slug: address }),
      open(b.token, { name: "Bella", slug: address }),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    assert.deepEqual(codes, [201, 409]);
    const winner = results.find((r) => r.statusCode === 201);
    await track(winner?.json().id);
    assert.equal(
      results.find((r) => r.statusCode === 409)?.json().error,
      "slug_taken",
    );
  });

  test("at most three stores awaiting approval per person", async () => {
    const u = await user();
    for (let i = 0; i < 3; i++) {
      const res = await open(u.token, { name: `Awa ${i}`, slug: slug() });
      assert.equal(res.statusCode, 201);
      await track(res.json().id);
    }
    const fourth = await open(u.token, { name: "Awa 4", slug: slug() });
    assert.equal(fourth.statusCode, 409);
    assert.equal(fourth.json().error, "too_many_pending");
  });
});
