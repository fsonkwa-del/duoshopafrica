import { execSync } from "node:child_process";
import { createDatabase } from "./client";
import {
  hasDownScript,
  lastAppliedMigration,
  migrateDown,
  schemaFingerprint,
} from "./migrate-down";

// CI (ADR 0008) : montée → descente de toutes les migrations réversibles en tête → montée.
// Le schéma final doit être identique à celui d'une montée simple.
const db = createDatabase();
const deploy = () => execSync("prisma migrate deploy", { stdio: "inherit" });
try {
  const before = await schemaFingerprint(db);
  const reverted: string[] = [];
  for (;;) {
    const last = await lastAppliedMigration(db);
    if (!last || !(await hasDownScript(last))) break;
    await migrateDown(db, last);
    reverted.push(last);
  }
  if (reverted.length === 0) throw new Error("No reversible migration found");
  console.log(`reverted: ${reverted.join(", ")}`);
  deploy();
  const after = await schemaFingerprint(db);
  const missing = before.filter((l) => !after.includes(l));
  const extra = after.filter((l) => !before.includes(l));
  if (missing.length || extra.length) {
    console.error({ missing, extra });
    throw new Error("Schema differs after down/up round trip");
  }
  console.log(`round trip ok (${before.length} schema facts)`);
} finally {
  await db.$disconnect();
}
