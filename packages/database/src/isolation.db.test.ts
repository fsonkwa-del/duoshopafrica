import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createDatabase } from "./client";

test("composite foreign key rejects a membership pointing into another tenant", async () => {
  const db = createDatabase();
  try {
    await assert.rejects(
      db.$transaction(async (tx) => {
        const first = await tx.tenant.create({ data: { name: "TEST-A" } });
        const second = await tx.tenant.create({ data: { name: "TEST-B" } });
        const store = await tx.store.create({
          data: {
            tenantId: first.id,
            slug: `test-${randomUUID()}`,
            name: "TEST",
          },
        });
        const user = await tx.user.create({
          data: { email: `${randomUUID()}@example.invalid` },
        });
        await tx.storeMember.create({
          data: {
            tenantId: second.id,
            storeId: store.id,
            userId: user.id,
            role: "OWNER",
          },
        });
        throw new Error("Unexpected success: constraint missing");
      }),
      (error: unknown) =>
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2003",
    );
  } finally {
    await db.$disconnect();
  }
});
