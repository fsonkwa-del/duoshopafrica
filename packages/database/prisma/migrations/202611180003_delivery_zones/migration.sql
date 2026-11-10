-- Lot 7 (ADR 0015) : frais de livraison par quartier au lieu d'un montant fixe par boutique.
-- Le montant fixe actuel devient le tarif « toutes zones » ; une ligne de zone le remplace
-- pour ce quartier (montant, ou NULL = quartier non desservi). Montant figé sur la commande.
CREATE TABLE "DeliveryZone" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoreZoneFee" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "zoneId" UUID NOT NULL,
    "feeMinor" BIGINT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreZoneFee_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Address" ADD COLUMN "zoneId" UUID;

CREATE UNIQUE INDEX "DeliveryZone_slug_key" ON "DeliveryZone"("slug");

CREATE INDEX "DeliveryZone_city_position_idx" ON "DeliveryZone"("city", "position");

CREATE UNIQUE INDEX "StoreZoneFee_storeId_zoneId_key" ON "StoreZoneFee"("storeId", "zoneId");

ALTER TABLE "StoreZoneFee" ADD CONSTRAINT "StoreZoneFee_tenantId_storeId_fkey" FOREIGN KEY ("tenantId", "storeId") REFERENCES "Store"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "StoreZoneFee" ADD CONSTRAINT "StoreZoneFee_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Address" ADD CONSTRAINT "Address_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Écrit à la main : invariants, RLS, quartiers initiaux ----------
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_values_valid" CHECK (
  "slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("slug") <= 60
  AND char_length("city") BETWEEN 2 AND 80 AND char_length("name") BETWEEN 2 AND 80);
ALTER TABLE "StoreZoneFee" ADD CONSTRAINT "StoreZoneFee_fee_valid" CHECK (
  "feeMinor" IS NULL OR "feeMinor" BETWEEN 0 AND 999999999);

-- Quartiers : lecture publique, gestion par l'administration.
ALTER TABLE "DeliveryZone" ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "DeliveryZone" FOR SELECT USING (true);
CREATE POLICY admin_insert ON "DeliveryZone" FOR INSERT WITH CHECK (app_platform_role() = 'ADMIN');
CREATE POLICY admin_update ON "DeliveryZone" FOR UPDATE
  USING (app_platform_role() = 'ADMIN') WITH CHECK (app_platform_role() = 'ADMIN');
GRANT SELECT, INSERT ON "DeliveryZone" TO duoshop_app;
GRANT UPDATE ("name", "position", "active") ON "DeliveryZone" TO duoshop_app;

-- Tarifs par zone : publics pour les boutiques actives (devis acheteur), écrits par la boutique.
ALTER TABLE "StoreZoneFee" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "StoreZoneFee" USING ("tenantId" = app_tenant_id());
CREATE POLICY public_read ON "StoreZoneFee" FOR SELECT USING (tenant_is_active("tenantId"));
GRANT SELECT, INSERT, DELETE ON "StoreZoneFee" TO duoshop_app;
GRANT UPDATE ("feeMinor", "updatedAt") ON "StoreZoneFee" TO duoshop_app;

-- Liste de départ de quartiers de Douala, modifiable par l'administration.
INSERT INTO "DeliveryZone" ("id", "slug", "city", "name", "position") VALUES
  (gen_random_uuid(), 'douala-akwa', 'Douala', 'Akwa', 10),
  (gen_random_uuid(), 'douala-bonanjo', 'Douala', 'Bonanjo', 20),
  (gen_random_uuid(), 'douala-bonapriso', 'Douala', 'Bonapriso', 30),
  (gen_random_uuid(), 'douala-deido', 'Douala', 'Deïdo', 40),
  (gen_random_uuid(), 'douala-bali', 'Douala', 'Bali', 50),
  (gen_random_uuid(), 'douala-new-bell', 'Douala', 'New Bell', 60),
  (gen_random_uuid(), 'douala-bepanda', 'Douala', 'Bepanda', 70),
  (gen_random_uuid(), 'douala-ndokoti', 'Douala', 'Ndokoti', 80),
  (gen_random_uuid(), 'douala-makepe', 'Douala', 'Makepe', 90),
  (gen_random_uuid(), 'douala-bonamoussadi', 'Douala', 'Bonamoussadi', 100),
  (gen_random_uuid(), 'douala-kotto', 'Douala', 'Kotto', 110),
  (gen_random_uuid(), 'douala-logpom', 'Douala', 'Logpom', 120),
  (gen_random_uuid(), 'douala-logbaba', 'Douala', 'Logbaba', 130),
  (gen_random_uuid(), 'douala-yassa', 'Douala', 'Yassa', 140),
  (gen_random_uuid(), 'douala-bonaberi', 'Douala', 'Bonabéri', 150);
