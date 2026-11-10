import { createDatabase } from "./client";
import {
  hasDownScript,
  lastAppliedMigration,
  migrateDown,
} from "./migrate-down";

// Exploitation : `pnpm db:down <migration>` défait la dernière migration appliquée (ADR 0008).
const [name] = process.argv.slice(2);
if (!name) throw new Error("Usage: db:down <migration_name>");
const db = createDatabase();
try {
  if (!(await hasDownScript(name)))
    throw new Error(
      `No down.sql for ${name}: this migration is not reversible`,
    );
  await migrateDown(db, name);
  console.log(`reverted ${name}; now at ${await lastAppliedMigration(db)}`);
} finally {
  await db.$disconnect();
}
