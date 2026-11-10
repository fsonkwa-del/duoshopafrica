-- Retour arrière des zones : refusé dès qu'une boutique a saisi un tarif ou qu'une adresse
-- est rattachée à un quartier.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "StoreZoneFee") OR EXISTS (SELECT 1 FROM "Address" WHERE "zoneId" IS NOT NULL) THEN
    RAISE EXCEPTION 'down refused: delivery zones are in use';
  END IF;
END
$$;
ALTER TABLE "Address" DROP CONSTRAINT "Address_zoneId_fkey";
ALTER TABLE "Address" DROP COLUMN "zoneId";
DROP TABLE "StoreZoneFee";
DROP TABLE "DeliveryZone";
