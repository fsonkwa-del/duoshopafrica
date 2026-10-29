import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { after, test } from "node:test";
import { createDatabase } from "./client";
import { purgeExpiredLoginAttempts } from "./maintenance";

const db = createDatabase();
const attempt = (expiresAt: Date) =>
  db.loginAttempt.create({
    data: {
      stateHash: randomBytes(32).toString("hex"),
      nonce: "test",
      codeVerifier: "test",
      returnTo: "/fr/account",
      expiresAt,
    },
  });

after(() => db.$disconnect());

test("purges only attempts expired beyond the grace period", async () => {
  const now = new Date();
  const old = await attempt(new Date(now.getTime() - 2 * 24 * 3600_000));
  const recent = await attempt(new Date(now.getTime() - 3600_000));
  const live = await attempt(new Date(now.getTime() + 600_000));
  try {
    assert.ok((await purgeExpiredLoginAttempts(db, now)) >= 1);
    const left = await db.loginAttempt.findMany({
      where: { id: { in: [old.id, recent.id, live.id] } },
      select: { id: true },
    });
    assert.deepEqual(left.map((a) => a.id).sort(), [recent.id, live.id].sort());
  } finally {
    await db.loginAttempt.deleteMany({
      where: { id: { in: [old.id, recent.id, live.id] } },
    });
  }
});

test("timestamps written by the application agree with the database clock", async () => {
  // Régression : sans session UTC, l'adaptateur décalait chaque date du fuseau du serveur.
  const written = await attempt(new Date());
  try {
    const [row] = await db.$queryRaw<{ skew: number }[]>`
      SELECT abs(extract(epoch FROM ("expiresAt" - now())))::float AS skew
        FROM "LoginAttempt" WHERE "id" = ${written.id}::uuid`;
    assert.ok(
      (row?.skew ?? Number.POSITIVE_INFINITY) < 5,
      `skew ${row?.skew}s`,
    );
  } finally {
    await db.loginAttempt.delete({ where: { id: written.id } });
  }
});
