import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { createDatabase, issueSessionToken } from "@duoshop/database";
import { SESSION_COOKIE } from "@duoshop/types";
import { createApp } from "./app";

const db = createDatabase({ max: 2 });
const webOrigin = "http://localhost:3000";
const app = await createApp({ db, webOrigin });
const ids = { tenants: [] as string[], users: [] as string[] };
const f = {
  storeA: "",
  storeB: "",
  storeC: "",
  owner: "",
  rival: "",
  formerMember: "",
  revoked: "",
  expired: "",
};

async function tenantWithStore(status: "ACTIVE" | "SUSPENDED") {
  const tenant = await db.tenant.create({
    data: { name: `TEST-API-${status}`, status },
  });
  ids.tenants.push(tenant.id);
  const store = await db.store.create({
    data: {
      tenantId: tenant.id,
      slug: `test-${randomUUID()}`,
      name: `TEST ${status}`,
    },
  });
  return store;
}
async function userWithSession(expiresInMs = 3600_000, revoked = false) {
  const user = await db.user.create({
    data: { email: `${randomUUID()}@example.invalid` },
  });
  ids.users.push(user.id);
  const { token, tokenHash } = issueSessionToken();
  await db.session.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + expiresInMs),
      revokedAt: revoked ? new Date() : null,
    },
  });
  return { user, token };
}
async function join(
  userId: string,
  store: { id: string; tenantId: string },
  active = true,
) {
  await db.storeMember.create({
    data: {
      tenantId: store.tenantId,
      storeId: store.id,
      userId,
      role: "OWNER",
      active,
    },
  });
}
const as = (token: string) => ({ cookie: `${SESSION_COOKIE}=${token}` });
const get = (url: string, token?: string) =>
  app.inject({ method: "GET", url, headers: token ? as(token) : {} });

before(async () => {
  const a = await tenantWithStore("ACTIVE");
  const b = await tenantWithStore("ACTIVE");
  const c = await tenantWithStore("SUSPENDED");
  const owner = await userWithSession();
  const rival = await userWithSession();
  const former = await userWithSession();
  await join(owner.user.id, a);
  await join(owner.user.id, c);
  await join(rival.user.id, b);
  await join(former.user.id, a, false);
  const revoked = await userWithSession(3600_000, true);
  const expired = await userWithSession(-1000);
  await join(revoked.user.id, a);
  await join(expired.user.id, a);
  Object.assign(f, {
    storeA: a.id,
    storeB: b.id,
    storeC: c.id,
    owner: owner.token,
    rival: rival.token,
    formerMember: former.token,
    revoked: revoked.token,
    expired: expired.token,
  });
});

after(async () => {
  await app.close();
  const tenantId = { in: ids.tenants };
  await db.auditLog.deleteMany({ where: { tenantId } });
  await db.storeMember.deleteMany({ where: { tenantId } });
  await db.store.deleteMany({ where: { tenantId } });
  await db.tenant.deleteMany({ where: { id: tenantId } });
  await db.session.deleteMany({ where: { userId: { in: ids.users } } });
  await db.user.deleteMany({ where: { id: { in: ids.users } } });
  await db.$disconnect();
});

describe("authenticated store access", () => {
  test("readiness reflects a reachable database", async () => {
    assert.equal((await get("/health/ready")).statusCode, 200);
  });

  test("rejects missing, malformed, revoked and expired sessions", async () => {
    for (const token of [undefined, "short", f.revoked, f.expired]) {
      assert.equal((await get("/v1/me", token)).statusCode, 401, String(token));
      assert.equal(
        (await get(`/v1/stores/${f.storeA}`, token)).statusCode,
        401,
      );
    }
  });

  test("a member reads its store and the access is audited", async () => {
    const response = await get(`/v1/stores/${f.storeA}`, f.owner);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().id, f.storeA);
    assert.equal(response.json().role, "OWNER");
    const audit = await db.auditLog.findFirst({
      where: { resourceId: f.storeA, action: "store.view" },
    });
    assert.ok(
      audit?.requestId,
      "store.view audit row with request id expected",
    );
  });

  test("another tenant's store is indistinguishable from a missing one", async () => {
    const foreign = await get(`/v1/stores/${f.storeB}`, f.owner);
    const missing = await get(`/v1/stores/${randomUUID()}`, f.owner);
    const reverse = await get(`/v1/stores/${f.storeA}`, f.rival);
    for (const response of [foreign, missing, reverse]) {
      assert.equal(response.statusCode, 404);
      assert.deepEqual(response.json(), { error: "not_found" });
    }
    assert.equal((await get("/v1/stores/not-a-uuid", f.owner)).statusCode, 400);
  });

  test("a deactivated membership loses access without revealing the store", async () => {
    const response = await get(`/v1/stores/${f.storeA}`, f.formerMember);
    assert.equal(response.statusCode, 404);
    assert.deepEqual((await get("/v1/me", f.formerMember)).json().stores, []);
  });

  test("a suspended tenant is refused and the refusal audited", async () => {
    const response = await get(`/v1/stores/${f.storeC}`, f.owner);
    assert.equal(response.statusCode, 403);
    const denied = await db.auditLog.count({
      where: { resourceId: f.storeC, action: "store.view.denied" },
    });
    assert.ok(denied >= 1);
  });

  test("/v1/me lists only the caller's own stores", async () => {
    const me = (await get("/v1/me", f.owner)).json();
    assert.deepEqual(
      me.stores.map((s: { id: string }) => s.id).sort(),
      [f.storeA, f.storeC].sort(),
    );
    const rival = (await get("/v1/me", f.rival)).json();
    assert.deepEqual(
      rival.stores.map((s: { id: string }) => s.id),
      [f.storeB],
    );
    assert.equal(me.platformRole, null);
  });

  test("/v1/me reveals the caller's active platform role, never a revoked one", async () => {
    const staff = await userWithSession();
    await db.platformMember.create({
      data: { userId: staff.user.id, role: "ADMIN" },
    });
    try {
      const me = (await get("/v1/me", staff.token)).json();
      assert.equal(me.platformRole, "ADMIN");
      assert.equal(me.mfa, false);
      await db.platformMember.update({
        where: { userId: staff.user.id },
        data: { active: false },
      });
      assert.equal(
        (await get("/v1/me", staff.token)).json().platformRole,
        null,
      );
    } finally {
      await db.platformMember.deleteMany({ where: { userId: staff.user.id } });
    }
  });

  test("interleaved concurrent requests on a small pool never cross tenants", async () => {
    const calls = Array.from({ length: 30 }, (_, i) =>
      i % 2
        ? get(`/v1/stores/${f.storeA}`, f.owner).then(
            (r) => [r, f.storeA] as const,
          )
        : get(`/v1/stores/${f.storeB}`, f.rival).then(
            (r) => [r, f.storeB] as const,
          ),
    );
    for (const [response, expected] of await Promise.all(calls)) {
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().id, expected);
    }
  });
});

describe("logout", () => {
  test("rejects a missing or foreign origin, then revokes the session", async () => {
    const { token } = await userWithSession();
    const post = (headers: Record<string, string>) =>
      app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        headers: { ...as(token), ...headers },
      });
    assert.equal((await post({})).statusCode, 403);
    assert.equal(
      (await post({ origin: "https://attacker.example" })).statusCode,
      403,
    );
    assert.equal((await get("/v1/me", token)).statusCode, 200);
    const out = await post({ origin: webOrigin });
    assert.equal(out.statusCode, 204);
    assert.match(String(out.headers["set-cookie"]), /Max-Age=0/);
    assert.equal((await get("/v1/me", token)).statusCode, 401);
  });
});
