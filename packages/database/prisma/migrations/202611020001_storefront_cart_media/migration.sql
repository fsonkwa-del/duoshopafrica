CREATE EXTENSION IF NOT EXISTS unaccent;
-- unaccent() n'est pas IMMUTABLE : enveloppe à dictionnaire fixe, utilisable dans une colonne générée.
CREATE FUNCTION search_unaccent(text) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
  AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;

-- CreateEnum
CREATE TYPE "MediaStatus" AS ENUM ('PENDING', 'READY', 'REJECTED');

-- AlterTable
ALTER TABLE "Product" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (
  to_tsvector('simple', search_unaccent(coalesce("title", '') || ' ' || coalesce("description", '')))
) STORED;
CREATE INDEX "Product_search_idx" ON "Product" USING GIN ("search");

-- CreateTable
CREATE TABLE "ProductMedia" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "MediaStatus" NOT NULL DEFAULT 'PENDING',
    "uploadKey" TEXT NOT NULL,
    "publicKey" TEXT,
    "altFr" TEXT NOT NULL,
    "altEn" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "rejectReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProductMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cart" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'XAF',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Cart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CartItem" (
    "id" UUID NOT NULL,
    "cartId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "addedPriceMinor" BIGINT NOT NULL,
    "addedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CartItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductMedia_uploadKey_key" ON "ProductMedia"("uploadKey");

-- CreateIndex
CREATE INDEX "ProductMedia_productId_position_idx" ON "ProductMedia"("productId", "position");

-- CreateIndex
CREATE INDEX "ProductMedia_status_createdAt_idx" ON "ProductMedia"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Cart_userId_key" ON "Cart"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CartItem_cartId_variantId_key" ON "CartItem"("cartId", "variantId");

-- AddForeignKey
ALTER TABLE "ProductMedia" ADD CONSTRAINT "ProductMedia_tenantId_productId_fkey" FOREIGN KEY ("tenantId", "productId") REFERENCES "Product"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "Cart"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Vitrine publique : lecture seule de ce qui est publié par un vendeur actif. Fonctions SECURITY
-- DEFINER car elles consultent Tenant/Product hors du tenant courant ; elles ne renvoient qu'un booléen.
CREATE FUNCTION tenant_is_active(p_tenant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
  $$ SELECT EXISTS (SELECT 1 FROM "Tenant" WHERE "id" = p_tenant AND "status" = 'ACTIVE') $$;
CREATE FUNCTION product_is_public(p_product uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
  $$ SELECT EXISTS (SELECT 1 FROM "Product" p WHERE p."id" = p_product
       AND p."status" = 'PUBLISHED' AND tenant_is_active(p."tenantId")) $$;
CREATE FUNCTION variant_is_public(p_variant uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
  $$ SELECT EXISTS (SELECT 1 FROM "ProductVariant" v WHERE v."id" = p_variant
       AND v."active" AND product_is_public(v."productId")) $$;
REVOKE ALL ON FUNCTION tenant_is_active(uuid), product_is_public(uuid), variant_is_public(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_is_active(uuid), product_is_public(uuid), variant_is_public(uuid) TO duoshop_app;

CREATE POLICY public_read ON "Store" FOR SELECT USING (tenant_is_active("tenantId"));
CREATE POLICY public_read ON "Product" FOR SELECT
  USING ("status" = 'PUBLISHED' AND tenant_is_active("tenantId"));
CREATE POLICY public_read ON "ProductVariant" FOR SELECT
  USING ("active" AND product_is_public("productId"));
CREATE POLICY public_read ON "StockLevel" FOR SELECT USING (variant_is_public("variantId"));

ALTER TABLE "ProductMedia" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "ProductMedia" USING ("tenantId" = app_tenant_id());
CREATE POLICY public_read ON "ProductMedia" FOR SELECT
  USING ("status" = 'READY' AND product_is_public("productId"));
GRANT SELECT, INSERT ON "ProductMedia" TO duoshop_app;
GRANT UPDATE ("position", "altFr", "altEn") ON "ProductMedia" TO duoshop_app;

-- Panier : visible et modifiable par son seul propriétaire.
ALTER TABLE "Cart" ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON "Cart" USING ("userId" = app_user_id());
ALTER TABLE "CartItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON "CartItem" USING (
  EXISTS (SELECT 1 FROM "Cart" c WHERE c."id" = "cartId" AND c."userId" = app_user_id()));
GRANT SELECT, INSERT ON "Cart" TO duoshop_app;
GRANT UPDATE ("updatedAt") ON "Cart" TO duoshop_app;
GRANT SELECT, INSERT, DELETE ON "CartItem" TO duoshop_app;
GRANT UPDATE ("quantity", "addedPriceMinor") ON "CartItem" TO duoshop_app;
ALTER TABLE "CartItem" ADD CONSTRAINT "CartItem_quantity_range" CHECK ("quantity" BETWEEN 1 AND 99);
