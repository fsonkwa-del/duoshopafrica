import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import type { Database } from "./scope";

// Retour arrière d'une migration (ADR 0008) : Prisma n'en gère pas. Chaque migration récente porte un
// down.sql à côté de migration.sql ; on ne défait que la dernière migration appliquée, dans une
// transaction qui retire aussi sa ligne de _prisma_migrations. Connexion propriétaire requise.
export const migrationsDir = join(import.meta.dirname, "../prisma/migrations");

export async function lastAppliedMigration(
  db: Database,
): Promise<string | null> {
  const [row] = await db.$queryRaw<{ name: string }[]>`
    SELECT migration_name AS name FROM _prisma_migrations
     WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
     ORDER BY migration_name DESC LIMIT 1`;
  return row?.name ?? null;
}

export async function hasDownScript(name: string): Promise<boolean> {
  return readFile(join(migrationsDir, name, "down.sql")).then(
    () => true,
    () => false,
  );
}

export async function migrateDown(db: Database, name: string): Promise<void> {
  const last = await lastAppliedMigration(db);
  if (last !== name)
    throw new Error(
      `Only the last applied migration can be reverted (last: ${last ?? "none"})`,
    );
  const sql = await readFile(join(migrationsDir, name, "down.sql"), "utf8");
  // Client pg direct : un script de plusieurs instructions passe par le protocole simple.
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    options: "-c TimeZone=UTC",
  });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "DELETE FROM _prisma_migrations WHERE migration_name = $1",
      [name],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

// Empreinte du schéma : ce qui doit être identique après montée → descente → montée.
export async function schemaFingerprint(db: Database): Promise<string[]> {
  const rows = await db.$queryRaw<{ line: string }[]>`
    SELECT 'column ' || c.table_name || '.' || c.column_name || ' ' || c.data_type || ' '
           || c.is_nullable || ' ' || coalesce(c.column_default, '') AS line
      FROM information_schema.columns c
     WHERE c.table_schema = 'public' AND c.table_name <> '_prisma_migrations'
    UNION ALL
    SELECT 'constraint ' || t.relname || '.' || k.conname || ' ' || pg_get_constraintdef(k.oid)
      FROM pg_constraint k JOIN pg_class t ON t.oid = k.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname <> '_prisma_migrations'
    UNION ALL
    SELECT 'index ' || indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    UNION ALL
    SELECT 'function ' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ') '
           || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(array_to_string(p.proacl, ','), '')
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      LEFT JOIN pg_depend d ON d.objid = p.oid AND d.deptype = 'e'
     WHERE n.nspname = 'public' AND d.objid IS NULL
    UNION ALL
    SELECT 'policy ' || tablename || '.' || policyname || ' ' || cmd || ' '
           || coalesce(qual, '') || ' ' || coalesce(with_check, '')
      FROM pg_policies WHERE schemaname = 'public'
    UNION ALL
    SELECT 'grant ' || table_name || ' ' || grantee || ' ' || privilege_type
      FROM information_schema.table_privileges
     WHERE table_schema = 'public' AND grantee NOT IN ('PUBLIC') AND table_name <> '_prisma_migrations'
       AND grantee <> current_user
    UNION ALL
    SELECT 'column_grant ' || table_name || '.' || column_name || ' ' || grantee || ' ' || privilege_type
      FROM information_schema.column_privileges
     WHERE table_schema = 'public' AND grantee <> current_user AND table_name <> '_prisma_migrations'
    UNION ALL
    SELECT 'trigger ' || c.relname || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid)
      FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND NOT t.tgisinternal
    UNION ALL
    SELECT 'enum ' || t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
      FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' GROUP BY t.typname
    UNION ALL
    SELECT 'rls ' || c.relname || ' ' || c.relrowsecurity || ' ' || c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'`;
  return rows.map((r) => r.line).sort();
}
