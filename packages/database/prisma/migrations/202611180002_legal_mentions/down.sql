-- Retour arrière des mentions légales. Les identités figées sur les commandes sont perdues :
-- refusé dès qu'une commande en porte une.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "SellerOrder" WHERE "sellerLegal" IS NOT NULL) THEN
    RAISE EXCEPTION 'down refused: SellerOrder.sellerLegal holds frozen seller identities';
  END IF;
END
$$;
DROP FUNCTION store_legal_mentions(uuid);
REVOKE UPDATE ("contactPhone", "contactEmail") ON "Store" FROM duoshop_app;
ALTER TABLE "Store" DROP CONSTRAINT "Store_contact_valid";
ALTER TABLE "SellerOrder" DROP COLUMN "sellerLegal";
ALTER TABLE "Store" DROP COLUMN "contactPhone", DROP COLUMN "contactEmail";
