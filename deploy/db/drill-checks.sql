-- Contrôles de l'exercice de restauration (lot 1) : une ligne « ok » ou « fail » par contrôle.
SELECT 'migrations' AS check,
       CASE WHEN count(*) > 0
             AND count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL) = 0
            THEN 'ok' ELSE 'fail' END AS result
  FROM _prisma_migrations
UNION ALL
SELECT 'ledger_balanced',
       CASE WHEN NOT EXISTS (
         SELECT 1 FROM "LedgerEntry" e GROUP BY e."journalId" HAVING sum(e."amountMinor") <> 0)
       THEN 'ok' ELSE 'fail' END
UNION ALL
-- Toute table lisible ou modifiable par le rôle applicatif est protégée par la RLS.
SELECT 'rls_enabled',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'fail' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
   AND has_table_privilege('duoshop_app', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
   -- Sans RLS par conception : référentiels publics ; sessions et tentatives de connexion, lues
   -- avant que l'utilisateur soit connu (empreintes de jetons seulement). Toute autre table
   -- accessible sans RLS fait échouer le contrôle.
   AND c.relname NOT IN ('Country', 'Locale', 'Currency', 'Role', 'Permission', 'RolePermission',
                         'Session', 'LoginAttempt')
UNION ALL
SELECT 'runtime_role_bypass',
       CASE WHEN NOT rolbypassrls AND NOT rolsuper THEN 'ok' ELSE 'fail' END
  FROM pg_roles WHERE rolname = 'duoshop_app';
