-- Lot 7 (ADR 0015) : mentions de la loi n° 2010/021 (liste exacte À VALIDER PAR JURISTE, H21).
-- Contact public de la boutique (distinct du téléphone privé du propriétaire déclaré au KYC) et
-- identité du vendeur figée sur chaque sous-commande au moment de l'achat.
ALTER TABLE "Store" ADD COLUMN "contactPhone" TEXT,
ADD COLUMN "contactEmail" TEXT;

ALTER TABLE "SellerOrder" ADD COLUMN "sellerLegal" JSONB;


-- ---------- Écrit à la main ----------
ALTER TABLE "Store" ADD CONSTRAINT "Store_contact_valid" CHECK (
  ("contactPhone" IS NULL OR "contactPhone" ~ '^\+[1-9][0-9]{7,14}$')
  AND ("contactEmail" IS NULL OR (char_length("contactEmail") <= 254
       AND "contactEmail" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')));
GRANT UPDATE ("contactPhone", "contactEmail") ON "Store" TO duoshop_app;

-- Mentions publiques d'une boutique vérifiée et active ; NULL sinon. Jamais le nom ni le
-- téléphone privés du propriétaire.
CREATE FUNCTION store_legal_mentions(p_store uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'legalName', v."legalName",
    'businessType', v."businessType",
    'registrationNumber', v."registrationNumber",
    'city', v."city",
    'district', v."district",
    'contactPhone', s."contactPhone",
    'contactEmail', s."contactEmail")
    FROM "Store" s
    JOIN "MerchantVerification" v ON v."storeId" = s."id"
   WHERE s."id" = p_store AND v."status" = 'APPROVED' AND tenant_is_active(s."tenantId")
$$;
REVOKE ALL ON FUNCTION store_legal_mentions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_legal_mentions(uuid) TO duoshop_app;
