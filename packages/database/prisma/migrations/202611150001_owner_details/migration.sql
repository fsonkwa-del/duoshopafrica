-- Informations du propriétaire déclarées avec la demande de vérification (sans pièce justificative :
-- le stockage des documents attend une politique de conservation validée). Colonnes facultatives
-- en base pour les demandes antérieures ; l'API les exige pour toute nouvelle demande.
CREATE TYPE "BusinessType" AS ENUM ('INDIVIDUAL', 'SOLE_PROPRIETOR', 'COMPANY');

ALTER TABLE "MerchantVerification"
  ADD COLUMN "businessType" "BusinessType",
  ADD COLUMN "ownerName" TEXT,
  ADD COLUMN "ownerPhone" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "district" TEXT;

GRANT UPDATE ("businessType", "ownerName", "ownerPhone", "city", "district")
  ON "MerchantVerification" TO duoshop_app;
