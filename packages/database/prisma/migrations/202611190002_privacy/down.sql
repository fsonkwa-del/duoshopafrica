-- Retour arrière du lot 2. Refusé dès qu'un consentement, une demande, un document publié, une
-- consultation journalisée ou une anonymisation existe : ce sont des preuves.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Consent") OR EXISTS (SELECT 1 FROM "DataRequest")
     OR EXISTS (SELECT 1 FROM "LegalDocument") OR EXISTS (SELECT 1 FROM "SensitiveAccessLog")
     OR EXISTS (SELECT 1 FROM "User" WHERE "anonymizedAt" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "Order" WHERE "cgvVersion" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "RegulatoryParameter" WHERE "proposedBy" IS NOT NULL
                  AND ("key" LIKE 'retention.%' OR "key" = 'data_request.response_window')) THEN
    RAISE EXCEPTION 'down refused: privacy records exist';
  END IF;
END
$$;
DROP FUNCTION apply_retention(boolean);
DROP FUNCTION reveal_store_owner(uuid, text);
DROP FUNCTION execute_erasure(uuid, text);
DROP FUNCTION anonymize_user(uuid);
DROP FUNCTION update_data_request(uuid, "DataRequestStatus", text);
DROP FUNCTION open_data_request("DataRequestKind", text);
DROP FUNCTION pending_consents(uuid);
DROP FUNCTION record_consent("LegalDocumentKind", integer, boolean, text);
DROP FUNCTION publish_legal_document("LegalDocumentKind", integer, text, text, text, timestamptz);
DROP FUNCTION current_legal_version("LegalDocumentKind", timestamptz);
ALTER POLICY staff_read ON "ParameterDefinition"
  USING (app_platform_role()::text IN ('ADMIN', 'FINANCE'));
ALTER POLICY staff_read ON "RegulatoryParameter"
  USING (app_platform_role()::text IN ('ADMIN', 'FINANCE'));
DROP TABLE "DataProcessingRegistry";
DROP TABLE "SensitiveAccessLog";
DROP TABLE "DataRequest";
DROP TABLE "Consent";
DROP TABLE "LegalDocument";
DROP FUNCTION app_privacy_staff();
DELETE FROM "RegulatoryParameter"
 WHERE "key" LIKE 'retention.%' OR "key" = 'data_request.response_window';
DELETE FROM "ParameterDefinition"
 WHERE "key" LIKE 'retention.%' OR "key" = 'data_request.response_window';
ALTER TABLE "Order" DROP COLUMN "cgvVersion";
ALTER TABLE "User" DROP COLUMN "anonymizedAt";
DROP TYPE "DataRequestStatus";
DROP TYPE "DataRequestKind";
DROP TYPE "LegalDocumentKind";
