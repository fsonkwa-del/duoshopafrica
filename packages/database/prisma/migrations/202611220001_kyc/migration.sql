-- Lot 5 (ADR 0013) : KYC vendeur par niveaux. Pièces chiffrées dans un coffre séparé (seule la
-- clé de données chiffrée est en base), validation par une autre personne, consultation journalisée,
-- plafonds de ventes mensuels par niveau. Pièces, plafonds et durées : À VALIDER PAR JURISTE (H17-H20).
CREATE TYPE "KycDocumentType" AS ENUM ('ID_CARD', 'PASSPORT', 'SELFIE', 'NIU_CERTIFICATE', 'RCCM', 'TAX_COMPLIANCE', 'STATUTES', 'DIRECTOR_ID');

CREATE TYPE "KycStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

CREATE TABLE "KycTierRequirement" (
    "tier" INTEGER NOT NULL,
    "documentType" "KycDocumentType" NOT NULL,
    "alternativeGroup" TEXT,

    CONSTRAINT "KycTierRequirement_pkey" PRIMARY KEY ("tier", "documentType")
);

CREATE TABLE "KycProfile" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "status" "KycStatus" NOT NULL DEFAULT 'DRAFT',
    "requestedTier" INTEGER,
    "approvedTier" INTEGER NOT NULL DEFAULT 0,
    "mobileMoneyNumber" TEXT,
    "location" TEXT,
    "niu" TEXT,
    "submittedBy" UUID,
    "submittedAt" TIMESTAMPTZ(3),
    "reviewedBy" UUID,
    "reviewedAt" TIMESTAMPTZ(3),
    "reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "KycProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "KycDocument" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "documentType" "KycDocumentType" NOT NULL,
    "objectKey" TEXT NOT NULL,
    "wrappedKey" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededAt" TIMESTAMPTZ(3),
    "purgeAfter" TIMESTAMPTZ(3),
    "purgedAt" TIMESTAMPTZ(3),

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KycProfile_storeId_key" ON "KycProfile"("storeId");

CREATE INDEX "KycProfile_status_submittedAt_idx" ON "KycProfile"("status", "submittedAt");

CREATE UNIQUE INDEX "KycDocument_objectKey_key" ON "KycDocument"("objectKey");

CREATE INDEX "KycDocument_storeId_documentType_idx" ON "KycDocument"("storeId", "documentType");

ALTER TABLE "KycProfile" ADD CONSTRAINT "KycProfile_tenantId_storeId_fkey" FOREIGN KEY ("tenantId", "storeId") REFERENCES "Store"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_tenantId_storeId_fkey" FOREIGN KEY ("tenantId", "storeId") REFERENCES "Store"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Écrit à la main ----------
ALTER TABLE "KycTierRequirement" ADD CONSTRAINT "KycTierRequirement_tier" CHECK ("tier" BETWEEN 1 AND 3);
ALTER TABLE "KycProfile" ADD CONSTRAINT "KycProfile_values_valid" CHECK (
  "approvedTier" BETWEEN 0 AND 3 AND ("requestedTier" IS NULL OR "requestedTier" BETWEEN 1 AND 3)
  AND ("mobileMoneyNumber" IS NULL OR "mobileMoneyNumber" ~ '^\+[1-9][0-9]{7,14}$')
  AND ("reviewedBy" IS NULL OR "reviewedBy" IS DISTINCT FROM "submittedBy")
  AND ("status" <> 'REJECTED' OR char_length("reason") >= 10));
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_values_valid" CHECK (
  "contentType" IN ('image/jpeg', 'image/png', 'application/pdf')
  AND "sizeBytes" BETWEEN 1 AND 5242880 AND "keyVersion" > 0 AND "sha256" ~ '^[0-9a-f]{64}$');

-- Pièces exigées par niveau (cumulatives) ; un groupe d'alternatives se satisfait par l'une d'elles.
INSERT INTO "KycTierRequirement" ("tier", "documentType", "alternativeGroup") VALUES
  (1, 'ID_CARD', 'identity'), (1, 'PASSPORT', 'identity'), (1, 'SELFIE', NULL),
  (2, 'NIU_CERTIFICATE', NULL), (2, 'RCCM', NULL),
  (3, 'STATUTES', NULL), (3, 'TAX_COMPLIANCE', NULL), (3, 'DIRECTOR_ID', NULL);

-- ---------- RLS ----------
-- Le vendeur voit son dossier ; ADMIN et COMPLIANCE l'instruisent. Aucune écriture directe du
-- dossier : fonctions dédiées. Métadonnées des pièces : insérées par l'API dans la boutique.
ALTER TABLE "KycTierRequirement" ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "KycTierRequirement" FOR SELECT USING (true);
GRANT SELECT ON "KycTierRequirement" TO duoshop_app;
ALTER TABLE "KycProfile" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_read ON "KycProfile" FOR SELECT USING ("tenantId" = app_tenant_id());
CREATE POLICY staff_read ON "KycProfile" FOR SELECT USING (app_privacy_staff());
GRANT SELECT ON "KycProfile" TO duoshop_app;
ALTER TABLE "KycDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "KycDocument" USING ("tenantId" = app_tenant_id());
CREATE POLICY staff_read ON "KycDocument" FOR SELECT USING (app_privacy_staff());
GRANT SELECT, INSERT ON "KycDocument" TO duoshop_app;
GRANT UPDATE ("supersededAt", "purgeAfter") ON "KycDocument" TO duoshop_app;

-- ---------- Paramètres (À VALIDER PAR JURISTE) ----------
INSERT INTO "ParameterDefinition" ("key", "kind", "ownerRole", "minValue", "maxValue", "labelFr", "labelEn") VALUES
  ('kyc.retention', 'duration', 'COMPLIANCE', '1 year', '30 years',
   'Conservation des pièces KYC remplacées ou refusées', 'Retention of replaced or rejected KYC documents'),
  ('kyc.enforce_caps', 'text', 'COMPLIANCE', NULL, NULL,
   'Plafonds de ventes appliqués (true/false)', 'Sales caps enforced (true/false)'),
  ('kyc.monthly_cap.tier0', 'amount', 'COMPLIANCE', '0', NULL,
   'Plafond mensuel sans KYC (FCFA)', 'Monthly cap without KYC (XAF)'),
  ('kyc.monthly_cap.tier1', 'amount', 'COMPLIANCE', '0', NULL,
   'Plafond mensuel niveau 1 (FCFA)', 'Monthly cap tier 1 (XAF)'),
  ('kyc.monthly_cap.tier2', 'amount', 'COMPLIANCE', '0', NULL,
   'Plafond mensuel niveau 2 (FCFA)', 'Monthly cap tier 2 (XAF)'),
  ('kyc.monthly_cap.tier3', 'amount', 'COMPLIANCE', '0', NULL,
   'Plafond mensuel niveau 3 (FCFA)', 'Monthly cap tier 3 (XAF)');
INSERT INTO "RegulatoryParameter" ("id", "key", "value", "effectiveFrom", "legalBasis", "approvedAt") VALUES
  (gen_random_uuid(), 'kyc.retention', '"10 years"', '2026-01-01T00:00:00Z',
   'Hypothèse H18. À valider par juriste.', now()),
  -- Désactivés tant que les montants ne sont pas fixés : à activer avant tout passage en LIVE.
  (gen_random_uuid(), 'kyc.enforce_caps', '"false"', '2026-01-01T00:00:00Z',
   'Montants à fixer (H20) ; activation avant le passage en LIVE.', now()),
  (gen_random_uuid(), 'kyc.monthly_cap.tier0', '"0"', '2026-01-01T00:00:00Z',
   'Sans KYC : aucune vente en argent réel (ADR 0013). À valider.', now()),
  (gen_random_uuid(), 'kyc.monthly_cap.tier1', '"1000000"', '2026-01-01T00:00:00Z',
   'Valeur provisoire, hypothèse H20. À fixer.', now()),
  (gen_random_uuid(), 'kyc.monthly_cap.tier2', '"10000000"', '2026-01-01T00:00:00Z',
   'Valeur provisoire, hypothèse H20. À fixer.', now()),
  (gen_random_uuid(), 'kyc.monthly_cap.tier3', '"100000000"', '2026-01-01T00:00:00Z',
   'Valeur provisoire, hypothèse H20. À fixer.', now());

-- ---------- Fonctions ----------
-- Pièces manquantes pour un niveau (cumulatif), d'après les pièces actives de la boutique.
CREATE FUNCTION kyc_missing_documents(p_store uuid, p_tier integer)
RETURNS SETOF "KycDocumentType"
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT r."documentType" FROM "KycTierRequirement" r
   WHERE r."tier" <= p_tier
     AND NOT EXISTS (SELECT 1 FROM "KycDocument" d WHERE d."storeId" = p_store
                       AND d."supersededAt" IS NULL AND d."purgedAt" IS NULL
                       AND (d."documentType" = r."documentType"
                            OR (r."alternativeGroup" IS NOT NULL AND d."documentType" IN (
                                  SELECT a."documentType" FROM "KycTierRequirement" a
                                   WHERE a."alternativeGroup" = r."alternativeGroup"))))
$$;

-- Dépôt du dossier par la boutique (contexte tenant, propriétaire vérifié par l'API).
CREATE FUNCTION submit_kyc(p_store uuid, p_tier integer, p_momo text, p_location text, p_niu text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_profile "KycProfile"%ROWTYPE;
BEGIN
  SELECT "tenantId" INTO v_tenant FROM "Store" WHERE "id" = p_store;
  IF v_tenant IS NULL OR v_tenant IS DISTINCT FROM app_tenant_id() OR app_user_id() IS NULL THEN
    RETURN 'forbidden';
  END IF;
  IF p_tier NOT BETWEEN 1 AND 3 THEN RETURN 'invalid_tier'; END IF;
  IF EXISTS (SELECT 1 FROM kyc_missing_documents(p_store, p_tier)) THEN RETURN 'documents_missing'; END IF;
  IF p_tier >= 2 AND char_length(btrim(coalesce(p_niu, ''))) < 5 THEN RETURN 'niu_required'; END IF;
  INSERT INTO "KycProfile" ("id", "tenantId", "storeId") VALUES (gen_random_uuid(), v_tenant, p_store)
  ON CONFLICT ("storeId") DO NOTHING;
  SELECT * INTO v_profile FROM "KycProfile" WHERE "storeId" = p_store FOR UPDATE;
  IF v_profile."status" = 'SUBMITTED' THEN RETURN 'already_submitted'; END IF;
  UPDATE "KycProfile"
     SET "status" = 'SUBMITTED', "requestedTier" = p_tier, "mobileMoneyNumber" = p_momo,
         "location" = btrim(p_location), "niu" = nullif(btrim(coalesce(p_niu, '')), ''),
         "submittedBy" = app_user_id(), "submittedAt" = now(), "reviewedBy" = NULL,
         "reviewedAt" = NULL, "reason" = NULL, "version" = "version" + 1
   WHERE "id" = v_profile."id";
  INSERT INTO "AuditLog" ("id", "tenantId", "actorId", "action", "resourceId", "requestId", "detail")
  VALUES (gen_random_uuid(), v_tenant, app_user_id()::text, 'store.kyc.submit', p_store::text,
    'kyc', jsonb_build_object('tier', p_tier));
  RETURN 'submitted';
END
$$;

-- Décision : ADMIN ou COMPLIANCE, jamais la personne qui a déposé le dossier ou une pièce.
CREATE FUNCTION review_kyc(p_store uuid, p_approve boolean, p_reason text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p "KycProfile"%ROWTYPE;
BEGIN
  IF NOT coalesce(app_privacy_staff(), false) THEN RETURN 'forbidden'; END IF;
  SELECT * INTO p FROM "KycProfile" WHERE "storeId" = p_store FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF p."status" <> 'SUBMITTED' THEN RETURN 'not_submitted'; END IF;
  IF p."submittedBy" = app_user_id() OR EXISTS (
       SELECT 1 FROM "KycDocument" WHERE "storeId" = p_store AND "uploadedBy" = app_user_id()) THEN
    RETURN 'same_person';
  END IF;
  IF NOT p_approve AND char_length(btrim(coalesce(p_reason, ''))) < 10 THEN RETURN 'reason_required'; END IF;
  IF p_approve AND EXISTS (SELECT 1 FROM kyc_missing_documents(p_store, p."requestedTier")) THEN
    RETURN 'documents_missing';
  END IF;
  UPDATE "KycProfile"
     SET "status" = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END::"KycStatus",
         "approvedTier" = CASE WHEN p_approve THEN p."requestedTier" ELSE p."approvedTier" END,
         "reviewedBy" = app_user_id(), "reviewedAt" = now(),
         "reason" = nullif(btrim(coalesce(p_reason, '')), ''), "version" = "version" + 1
   WHERE "id" = p."id";
  INSERT INTO "ConfigAudit" ("id", "actorId", "entity", "entityId", "action", "after")
  VALUES (gen_random_uuid(), app_user_id(), 'KycProfile', p."id",
    CASE WHEN p_approve THEN 'approve' ELSE 'reject' END,
    jsonb_build_object('storeId', p_store, 'tier', p."requestedTier",
      'reason', nullif(btrim(coalesce(p_reason, '')), '')));
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END
$$;

-- Consultation d'une pièce : motif obligatoire, journalisée ; renvoie de quoi la déchiffrer.
CREATE FUNCTION reveal_kyc_document(p_document uuid, p_reason text)
RETURNS TABLE ("objectKey" text, "wrappedKey" bytea, "keyVersion" integer, "contentType" text,
  "sha256" text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d "KycDocument"%ROWTYPE;
BEGIN
  IF NOT coalesce(app_privacy_staff(), false) THEN
    RETURN QUERY SELECT NULL::text, NULL::bytea, NULL::integer, NULL::text, NULL::text, 'forbidden'; RETURN;
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RETURN QUERY SELECT NULL::text, NULL::bytea, NULL::integer, NULL::text, NULL::text, 'reason_required'; RETURN;
  END IF;
  SELECT * INTO d FROM "KycDocument" WHERE "id" = p_document AND "purgedAt" IS NULL;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::text, NULL::bytea, NULL::integer, NULL::text, NULL::text, 'not_found'; RETURN;
  END IF;
  INSERT INTO "SensitiveAccessLog" ("id", "actorId", "resource", "resourceId", "reason")
  VALUES (gen_random_uuid(), app_user_id(), 'kyc_document', p_document, btrim(p_reason));
  RETURN QUERY SELECT d."objectKey", d."wrappedKey", d."keyVersion", d."contentType", d."sha256"::text, 'ok';
END
$$;

-- Plafond de ventes du mois (heure de Douala) selon le niveau KYC approuvé. Verrou par boutique :
-- deux commandes simultanées ne dépassent pas le plafond ensemble.
CREATE FUNCTION store_cap_allows(p_store uuid, p_amount bigint)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tier integer;
  v_cap bigint;
  v_month timestamptz := date_trunc('month', now() AT TIME ZONE 'Africa/Douala') AT TIME ZONE 'Africa/Douala';
  v_sold bigint;
BEGIN
  IF coalesce(param_value_or_null('kyc.enforce_caps'), 'false') <> 'true' THEN RETURN true; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('store_cap:' || p_store::text, 0));
  SELECT coalesce((SELECT "approvedTier" FROM "KycProfile" WHERE "storeId" = p_store), 0) INTO v_tier;
  v_cap := coalesce(param_value_or_null('kyc.monthly_cap.tier' || v_tier), '0')::bigint;
  -- Ventes payées du mois et commandes en attente de paiement (réservées).
  SELECT coalesce(sum(so."itemsTotalMinor" + so."deliveryFeeMinor"), 0) INTO v_sold
    FROM "SellerOrder" so JOIN "Order" o ON o."id" = so."orderId"
   WHERE so."storeId" = p_store AND o."createdAt" >= v_month
     AND (so."status" = 'PAID' OR o."status" = 'AWAITING_PAYMENT');
  RETURN v_sold + p_amount <= v_cap;
END
$$;

-- Pièces à effacer du coffre (remplacées ou d'un dossier refusé, conservation écoulée) : le worker
-- supprime l'objet puis appelle mark_kyc_purged. Connexion propriétaire uniquement.
CREATE FUNCTION kyc_documents_to_purge(p_limit integer)
RETURNS TABLE ("id" uuid, "objectKey" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT d."id", d."objectKey" FROM "KycDocument" d
   WHERE d."purgedAt" IS NULL AND d."purgeAfter" IS NOT NULL AND d."purgeAfter" < now()
   ORDER BY d."purgeAfter" LIMIT least(greatest(p_limit, 0), 200)
$$;
CREATE FUNCTION mark_kyc_purged(p_document uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE "KycDocument" SET "purgedAt" = now(), "wrappedKey" = '\x00'::bytea WHERE "id" = p_document
$$;

REVOKE ALL ON FUNCTION kyc_missing_documents(uuid, integer),
  submit_kyc(uuid, integer, text, text, text), review_kyc(uuid, boolean, text),
  reveal_kyc_document(uuid, text), store_cap_allows(uuid, bigint),
  kyc_documents_to_purge(integer), mark_kyc_purged(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION kyc_missing_documents(uuid, integer),
  submit_kyc(uuid, integer, text, text, text), review_kyc(uuid, boolean, text),
  reveal_kyc_document(uuid, text), store_cap_allows(uuid, bigint) TO duoshop_app;
