-- Retour arrière du lot 5 : refusé dès qu'un dossier ou une pièce existe (le coffre contiendrait
-- des objets orphelins).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "KycProfile") OR EXISTS (SELECT 1 FROM "KycDocument")
     OR EXISTS (SELECT 1 FROM "RegulatoryParameter" WHERE "proposedBy" IS NOT NULL AND "key" LIKE 'kyc.%') THEN
    RAISE EXCEPTION 'down refused: KYC records exist';
  END IF;
END
$$;
DROP FUNCTION mark_kyc_purged(uuid);
DROP FUNCTION kyc_documents_to_purge(integer);
DROP FUNCTION store_cap_allows(uuid, bigint);
DROP FUNCTION reveal_kyc_document(uuid, text);
DROP FUNCTION review_kyc(uuid, boolean, text);
DROP FUNCTION submit_kyc(uuid, integer, text, text, text);
DROP FUNCTION kyc_missing_documents(uuid, integer);
DROP TABLE "KycDocument";
DROP TABLE "KycProfile";
DROP TABLE "KycTierRequirement";
DELETE FROM "RegulatoryParameter" WHERE "key" LIKE 'kyc.%';
DELETE FROM "ParameterDefinition" WHERE "key" LIKE 'kyc.%';
DROP TYPE "KycStatus";
DROP TYPE "KycDocumentType";
