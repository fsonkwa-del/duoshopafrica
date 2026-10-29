-- Rôle runtime : jamais propriétaire des tables, jamais BYPASSRLS.
-- NOLOGIN : l'API l'endosse par SET LOCAL ROLE dans chaque transaction métier.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'duoshop_app') THEN
    CREATE ROLE duoshop_app NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;
  END IF;
END $$;
GRANT duoshop_app TO CURRENT_USER;

GRANT USAGE ON SCHEMA public TO duoshop_app;
GRANT SELECT ON "User", "Tenant", "Store", "StoreMember", "MerchantVerification",
  "Country", "Currency", "Locale", "Role", "Permission", "RolePermission" TO duoshop_app;
-- Session : recherche par empreinte du jeton (secret), révocation seule modifiable.
GRANT SELECT, INSERT ON "Session" TO duoshop_app;
GRANT UPDATE ("revokedAt") ON "Session" TO duoshop_app;
-- Audit : ajout et lecture, jamais modification ni suppression par le runtime.
GRANT SELECT, INSERT ON "AuditLog" TO duoshop_app;
GRANT SELECT, INSERT ON "OutboxEvent" TO duoshop_app;

-- Contexte de requête posé par set_config(..., true) : absent => NULL => aucune ligne.
CREATE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
GRANT EXECUTE ON FUNCTION app_tenant_id(), app_user_id() TO duoshop_app;

-- RLS non forcée : le propriétaire (migrations, seed) n'est pas filtré ; le runtime l'est.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
CREATE POLICY self_scope ON "User" USING ("id" = app_user_id());

ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "Tenant" USING ("id" = app_tenant_id());

ALTER TABLE "Store" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "Store" USING ("tenantId" = app_tenant_id());

-- Un utilisateur voit ses propres adhésions pour résoudre le tenant avant d'y entrer.
ALTER TABLE "StoreMember" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "StoreMember"
  USING ("tenantId" = app_tenant_id() OR "userId" = app_user_id());

ALTER TABLE "MerchantVerification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "MerchantVerification" USING ("tenantId" = app_tenant_id());

ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "AuditLog"
  USING ("tenantId" = app_tenant_id()) WITH CHECK ("tenantId" = app_tenant_id());

ALTER TABLE "OutboxEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "OutboxEvent"
  USING ("tenantId" = app_tenant_id()) WITH CHECK ("tenantId" = app_tenant_id());
