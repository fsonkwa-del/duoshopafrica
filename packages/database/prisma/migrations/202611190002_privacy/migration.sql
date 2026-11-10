-- Lot 2 (ADR 0010) : documents légaux versionnés, consentements en ajout seul, demandes des
-- personnes, journal des consultations sensibles, registre des traitements, conservation.
-- Les textes viennent du juriste ; aucune base légale ni durée n'est présentée comme validée.
CREATE TYPE "LegalDocumentKind" AS ENUM ('CGU', 'CGV', 'PRIVACY', 'MARKETING');

CREATE TYPE "DataRequestKind" AS ENUM ('RECTIFICATION', 'ERASURE', 'OTHER');

CREATE TYPE "DataRequestStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'REJECTED');

ALTER TABLE "User" ADD COLUMN "anonymizedAt" TIMESTAMPTZ(3);

ALTER TABLE "Order" ADD COLUMN "cgvVersion" INTEGER;

CREATE TABLE "LegalDocument" (
    "id" UUID NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "locale" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "publishedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Consent" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "LegalDocumentKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataRequest" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" "DataRequestKind" NOT NULL,
    "message" TEXT NOT NULL,
    "status" "DataRequestStatus" NOT NULL DEFAULT 'OPEN',
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "assignedTo" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "DataRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SensitiveAccessLog" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SensitiveAccessLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DataProcessingRegistry" (
    "key" TEXT NOT NULL,
    "purposeFr" TEXT NOT NULL,
    "purposeEn" TEXT NOT NULL,
    "legalBasis" TEXT NOT NULL,
    "dataCategories" TEXT NOT NULL,
    "subjects" TEXT NOT NULL,
    "recipients" TEXT NOT NULL,
    "retentionParameter" TEXT,
    "storageLocation" TEXT NOT NULL,
    "security" TEXT NOT NULL,
    "validationStatus" "ParameterStatus" NOT NULL DEFAULT 'A_VALIDER',

    CONSTRAINT "DataProcessingRegistry_pkey" PRIMARY KEY ("key")
);

CREATE UNIQUE INDEX "LegalDocument_kind_version_locale_key" ON "LegalDocument"("kind", "version", "locale");

CREATE INDEX "Consent_userId_kind_createdAt_idx" ON "Consent"("userId", "kind", "createdAt");

CREATE INDEX "DataRequest_status_dueAt_idx" ON "DataRequest"("status", "dueAt");

CREATE INDEX "DataRequest_userId_createdAt_idx" ON "DataRequest"("userId", "createdAt");

CREATE INDEX "SensitiveAccessLog_resourceId_createdAt_idx" ON "SensitiveAccessLog"("resourceId", "createdAt");

CREATE INDEX "SensitiveAccessLog_actorId_createdAt_idx" ON "SensitiveAccessLog"("actorId", "createdAt");

ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "DataProcessingRegistry" ADD CONSTRAINT "DataProcessingRegistry_retentionParameter_fkey" FOREIGN KEY ("retentionParameter") REFERENCES "ParameterDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Écrit à la main : invariants ----------
ALTER TABLE "LegalDocument" ADD CONSTRAINT "LegalDocument_values_valid" CHECK (
  "version" > 0 AND "locale" IN ('fr', 'en')
  AND char_length("title") BETWEEN 3 AND 200 AND char_length("body") BETWEEN 20 AND 200000
  AND "sha256" ~ '^[0-9a-f]{64}$');
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_values_valid" CHECK (
  "version" > 0 AND "source" IN ('signup', 'account', 'checkout', 'update'));
ALTER TABLE "DataRequest" ADD CONSTRAINT "DataRequest_values_valid" CHECK (
  char_length("message") BETWEEN 10 AND 2000
  AND ("resolution" IS NULL OR char_length("resolution") <= 2000)
  AND (("status" IN ('DONE', 'REJECTED')) = ("closedAt" IS NOT NULL)));
ALTER TABLE "SensitiveAccessLog" ADD CONSTRAINT "SensitiveAccessLog_reason_length" CHECK (
  char_length("reason") BETWEEN 10 AND 500 AND char_length("resource") BETWEEN 3 AND 60);

-- ---------- RLS ----------
-- Personnel « données personnelles » : ADMIN et COMPLIANCE ; SUPPORT traite les demandes.
CREATE FUNCTION app_privacy_staff() RETURNS boolean LANGUAGE sql STABLE AS
  $$ SELECT app_platform_role()::text IN ('ADMIN', 'COMPLIANCE') $$;
GRANT EXECUTE ON FUNCTION app_privacy_staff() TO duoshop_app;

ALTER TABLE "LegalDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "LegalDocument" FOR SELECT USING (true);
GRANT SELECT ON "LegalDocument" TO duoshop_app;

ALTER TABLE "Consent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON "Consent" FOR SELECT USING ("userId" = app_user_id());
CREATE POLICY staff_read ON "Consent" FOR SELECT USING (app_privacy_staff());
GRANT SELECT ON "Consent" TO duoshop_app;

ALTER TABLE "DataRequest" ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_read ON "DataRequest" FOR SELECT USING ("userId" = app_user_id());
CREATE POLICY staff_read ON "DataRequest" FOR SELECT
  USING (app_platform_role()::text IN ('ADMIN', 'SUPPORT', 'COMPLIANCE'));
GRANT SELECT ON "DataRequest" TO duoshop_app;

ALTER TABLE "SensitiveAccessLog" ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON "SensitiveAccessLog" FOR SELECT USING (app_privacy_staff());
GRANT SELECT ON "SensitiveAccessLog" TO duoshop_app;

ALTER TABLE "DataProcessingRegistry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON "DataProcessingRegistry" FOR SELECT USING (app_platform_role() IS NOT NULL);
GRANT SELECT ON "DataProcessingRegistry" TO duoshop_app;

-- Le personnel conformité lit aussi les paramètres réglementaires (il en propose certains).
ALTER POLICY staff_read ON "ParameterDefinition"
  USING (app_platform_role()::text IN ('ADMIN', 'FINANCE', 'COMPLIANCE'));
ALTER POLICY staff_read ON "RegulatoryParameter"
  USING (app_platform_role()::text IN ('ADMIN', 'FINANCE', 'COMPLIANCE'));

-- ---------- Documents légaux ----------
-- Version courante d'un type : la plus haute version entrée en vigueur (toutes langues confondues).
CREATE FUNCTION current_legal_version(p_kind "LegalDocumentKind", p_at timestamptz DEFAULT now())
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
  $$ SELECT max("version") FROM "LegalDocument" WHERE "kind" = p_kind AND "effectiveFrom" <= p_at $$;

-- Publication par ADMIN ou COMPLIANCE : version suivante, jamais rétroactive, texte immuable.
CREATE FUNCTION publish_legal_document(p_kind "LegalDocumentKind", p_version integer, p_locale text,
  p_title text, p_body text, p_from timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid := gen_random_uuid();
  v_latest integer;
BEGIN
  IF NOT coalesce(app_privacy_staff(), false) THEN
    RAISE EXCEPTION 'legal_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_from < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'legal_retroactive' USING ERRCODE = '22023';
  END IF;
  SELECT max("version") INTO v_latest FROM "LegalDocument" WHERE "kind" = p_kind;
  -- Même version dans une autre langue, ou version suivante.
  IF p_version IS NULL OR p_version < 1 OR p_version > coalesce(v_latest, 0) + 1
     OR (p_version <= coalesce(v_latest, 0) AND NOT EXISTS (
           SELECT 1 FROM "LegalDocument" WHERE "kind" = p_kind AND "version" = p_version
              AND "effectiveFrom" = p_from)) THEN
    RAISE EXCEPTION 'legal_version' USING ERRCODE = '22023';
  END IF;
  INSERT INTO "LegalDocument" ("id", "kind", "version", "locale", "title", "body", "sha256",
    "effectiveFrom", "publishedBy")
  VALUES (v_id, p_kind, p_version, p_locale, btrim(p_title), p_body,
    encode(sha256(convert_to(p_body, 'UTF8')), 'hex'), p_from, app_user_id());
  INSERT INTO "ConfigAudit" ("id", "actorId", "entity", "entityId", "action", "after")
  VALUES (gen_random_uuid(), app_user_id(), 'LegalDocument', v_id, 'publish',
    jsonb_build_object('kind', p_kind, 'version', p_version, 'locale', p_locale,
      'effectiveFrom', p_from));
  RETURN v_id;
END
$$;

-- Consentement de l'utilisateur courant : seulement pour une version publiée et en vigueur.
CREATE FUNCTION record_consent(p_kind "LegalDocumentKind", p_version integer, p_granted boolean,
  p_source text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_user_id() IS NULL THEN RETURN 'unauthenticated'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "LegalDocument" WHERE "kind" = p_kind AND "version" = p_version
                   AND "effectiveFrom" <= now()) THEN
    RETURN 'unknown_version';
  END IF;
  -- Seul le marketing se retire ; CGU, CGV et confidentialité s'acceptent (ou on quitte le service).
  IF NOT p_granted AND p_kind <> 'MARKETING' THEN RETURN 'cannot_withdraw'; END IF;
  INSERT INTO "Consent" ("id", "userId", "kind", "version", "granted", "source")
  VALUES (gen_random_uuid(), app_user_id(), p_kind, p_version, p_granted, p_source);
  RETURN 'recorded';
END
$$;

-- Documents à accepter avant toute action : CGU et confidentialité en vigueur non acceptées.
CREATE FUNCTION pending_consents(p_user uuid)
RETURNS TABLE (kind "LegalDocumentKind", version integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT k.kind, current_legal_version(k.kind)
    FROM (VALUES ('CGU'::"LegalDocumentKind"), ('PRIVACY'::"LegalDocumentKind")) AS k(kind)
   WHERE current_legal_version(k.kind) IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "Consent" c WHERE c."userId" = p_user AND c."kind" = k.kind
                       AND c."version" = current_legal_version(k.kind) AND c."granted")
$$;

-- ---------- Demandes des personnes ----------
CREATE FUNCTION open_data_request(p_kind "DataRequestKind", p_message text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  IF app_user_id() IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  INSERT INTO "DataRequest" ("id", "userId", "kind", "message", "dueAt")
  VALUES (v_id, app_user_id(), p_kind, btrim(p_message),
    now() + param_interval('data_request.response_window'));
  RETURN v_id;
END
$$;

-- Traitement par le SUPPORT, l'ADMIN ou la conformité ; motif obligatoire pour clore.
CREATE FUNCTION update_data_request(p_id uuid, p_status "DataRequestStatus", p_resolution text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r "DataRequest"%ROWTYPE;
BEGIN
  IF app_platform_role()::text NOT IN ('ADMIN', 'SUPPORT', 'COMPLIANCE') OR app_platform_role() IS NULL THEN
    RETURN 'forbidden';
  END IF;
  SELECT * INTO r FROM "DataRequest" WHERE "id" = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF r."status" IN ('DONE', 'REJECTED') THEN RETURN 'already_closed'; END IF;
  IF p_status = 'OPEN' THEN RETURN 'invalid_transition'; END IF;
  IF p_status IN ('DONE', 'REJECTED') AND char_length(btrim(coalesce(p_resolution, ''))) < 10 THEN
    RETURN 'resolution_required';
  END IF;
  -- Une suppression se clôt par l'anonymisation (execute_erasure), jamais à la main.
  IF r."kind" = 'ERASURE' AND p_status = 'DONE' THEN RETURN 'use_erasure'; END IF;
  UPDATE "DataRequest"
     SET "status" = p_status, "assignedTo" = app_user_id(),
         "resolution" = coalesce(nullif(btrim(coalesce(p_resolution, '')), ''), "resolution"),
         "closedAt" = CASE WHEN p_status IN ('DONE', 'REJECTED') THEN now() END
   WHERE "id" = p_id;
  INSERT INTO "ConfigAudit" ("id", "actorId", "entity", "entityId", "action", "after")
  VALUES (gen_random_uuid(), app_user_id(), 'DataRequest', p_id, 'update',
    jsonb_build_object('status', p_status));
  RETURN 'ok';
END
$$;

-- Anonymisation : l'identité disparaît, les pièces comptables et contractuelles restent
-- (rattachées à un identifiant sans e-mail ni téléphone). Refusée tant qu'une commande, une
-- réclamation ou un remboursement est en cours, ou que la personne est membre d'une boutique.
CREATE FUNCTION anonymize_user(p_user uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE u "User"%ROWTYPE;
BEGIN
  SELECT * INTO u FROM "User" WHERE "id" = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF u."anonymizedAt" IS NOT NULL THEN RETURN 'already_anonymized'; END IF;
  IF EXISTS (SELECT 1 FROM "StoreMember" WHERE "userId" = p_user AND "active")
     OR EXISTS (SELECT 1 FROM "PlatformMember" WHERE "userId" = p_user AND "active") THEN
    RETURN 'blocked_member';
  END IF;
  IF EXISTS (SELECT 1 FROM "Order" o WHERE o."buyerId" = p_user
               AND (o."status" = 'AWAITING_PAYMENT' OR EXISTS (
                     SELECT 1 FROM "SellerOrder" so WHERE so."orderId" = o."id"
                        AND so."status" = 'PAID' AND so."fulfilmentStatus" <> 'DELIVERED')))
     OR EXISTS (SELECT 1 FROM "Claim" WHERE "buyerId" = p_user
                  AND "status" IN ('OPEN', 'REJECTED', 'ESCALATED'))
     OR EXISTS (SELECT 1 FROM "Refund" r JOIN "Claim" c ON c."id" = r."claimId"
                 WHERE c."buyerId" = p_user AND r."status" = 'PENDING_PROVIDER') THEN
    RETURN 'blocked_activity';
  END IF;
  UPDATE "User" SET "email" = 'anonyme-' || "id" || '@anonymized.invalid', "anonymizedAt" = now()
   WHERE "id" = p_user;
  DELETE FROM "Identity" WHERE "userId" = p_user;
  DELETE FROM "Session" WHERE "userId" = p_user;
  DELETE FROM "Notification" WHERE "userId" = p_user;
  DELETE FROM "CartItem" WHERE "cartId" IN (SELECT "id" FROM "Cart" WHERE "userId" = p_user);
  DELETE FROM "Cart" WHERE "userId" = p_user;
  DELETE FROM "HandoverCode" WHERE "buyerId" = p_user;
  UPDATE "Address"
     SET "label" = '-', "recipientName" = '-', "phone" = '+237600000000', "landmark" = '---',
         "details" = NULL, "latitude" = NULL, "longitude" = NULL,
         "archivedAt" = coalesce("archivedAt", now())
   WHERE "userId" = p_user;
  -- Quartier et ville gardés : nécessaires aux litiges et à la comptabilité de la livraison.
  UPDATE "Order"
     SET "addressSnapshot" = jsonb_build_object('city', "addressSnapshot"->>'city',
                                                'district', "addressSnapshot"->>'district')
   WHERE "buyerId" = p_user AND "addressSnapshot" IS NOT NULL;
  UPDATE "SellerOrder" so SET "deliveryContact" = NULL
    FROM "Order" o WHERE o."id" = so."orderId" AND o."buyerId" = p_user;
  UPDATE "Payment" SET "payerPhone" = NULL WHERE "buyerId" = p_user;
  RETURN 'anonymized';
END
$$;

-- Exécution d'une demande de suppression : ADMIN ou conformité, une seule fois, tracée.
CREATE FUNCTION execute_erasure(p_request uuid, p_resolution text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r "DataRequest"%ROWTYPE;
  v_outcome text;
BEGIN
  IF NOT coalesce(app_privacy_staff(), false) THEN RETURN 'forbidden'; END IF;
  SELECT * INTO r FROM "DataRequest" WHERE "id" = p_request FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF r."kind" <> 'ERASURE' THEN RETURN 'not_erasure'; END IF;
  IF r."status" IN ('DONE', 'REJECTED') THEN RETURN 'already_closed'; END IF;
  IF char_length(btrim(coalesce(p_resolution, ''))) < 10 THEN RETURN 'resolution_required'; END IF;
  v_outcome := anonymize_user(r."userId");
  IF v_outcome NOT IN ('anonymized', 'already_anonymized') THEN RETURN v_outcome; END IF;
  UPDATE "DataRequest" SET "status" = 'DONE', "assignedTo" = app_user_id(),
         "resolution" = btrim(p_resolution), "closedAt" = now()
   WHERE "id" = p_request;
  INSERT INTO "ConfigAudit" ("id", "actorId", "entity", "entityId", "action", "after")
  VALUES (gen_random_uuid(), app_user_id(), 'DataRequest', p_request, 'erase',
    jsonb_build_object('outcome', v_outcome));
  RETURN 'anonymized';
END
$$;

-- ---------- Consultations sensibles ----------
-- Contact privé du propriétaire déclaré au KYC : motif obligatoire, consultation journalisée.
CREATE FUNCTION reveal_store_owner(p_store uuid, p_reason text)
RETURNS TABLE (owner_name text, owner_phone text, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v "MerchantVerification"%ROWTYPE;
BEGIN
  IF app_platform_role()::text NOT IN ('ADMIN', 'SUPPORT', 'COMPLIANCE') OR app_platform_role() IS NULL THEN
    RETURN QUERY SELECT NULL::text, NULL::text, 'forbidden'; RETURN;
  END IF;
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RETURN QUERY SELECT NULL::text, NULL::text, 'reason_required'; RETURN;
  END IF;
  SELECT * INTO v FROM "MerchantVerification" WHERE "storeId" = p_store;
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::text, NULL::text, 'not_found'; RETURN; END IF;
  INSERT INTO "SensitiveAccessLog" ("id", "actorId", "resource", "resourceId", "reason")
  VALUES (gen_random_uuid(), app_user_id(), 'store_owner_contact', p_store, btrim(p_reason));
  RETURN QUERY SELECT v."ownerName", v."ownerPhone", 'ok';
END
$$;

-- ---------- Conservation ----------
-- Une passe : comptes inactifs anonymisés, notifications et sessions anciennes supprimées.
-- p_enforce = false : comptage seul (exécution à blanc), rien n'est modifié.
CREATE FUNCTION apply_retention(p_enforce boolean)
RETURNS TABLE (rule text, affected integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_count integer;
  v_user uuid;
  v_inactive interval := param_interval('retention.inactive_account');
BEGIN
  SELECT count(*)::integer INTO v_count FROM "Notification"
   WHERE "createdAt" < now() - param_interval('retention.notifications');
  IF p_enforce THEN
    DELETE FROM "Notification" WHERE "createdAt" < now() - param_interval('retention.notifications');
  END IF;
  rule := 'notifications'; affected := v_count; RETURN NEXT;

  SELECT count(*)::integer INTO v_count FROM "Session"
   WHERE coalesce("revokedAt", "expiresAt") < now() - param_interval('retention.sessions');
  IF p_enforce THEN
    DELETE FROM "Session"
     WHERE coalesce("revokedAt", "expiresAt") < now() - param_interval('retention.sessions');
  END IF;
  rule := 'sessions'; affected := v_count; RETURN NEXT;

  -- Compte inactif : ni session, ni commande depuis la durée paramétrée, et sans rôle actif.
  v_count := 0;
  FOR v_user IN
    SELECT u."id" FROM "User" u
     WHERE u."anonymizedAt" IS NULL AND u."createdAt" < now() - v_inactive
       AND NOT EXISTS (SELECT 1 FROM "Session" s WHERE s."userId" = u."id"
                         AND s."lastSeenAt" >= now() - v_inactive)
       AND NOT EXISTS (SELECT 1 FROM "Order" o WHERE o."buyerId" = u."id"
                         AND o."createdAt" >= now() - v_inactive)
       AND NOT EXISTS (SELECT 1 FROM "StoreMember" m WHERE m."userId" = u."id" AND m."active")
       AND NOT EXISTS (SELECT 1 FROM "PlatformMember" p WHERE p."userId" = u."id" AND p."active")
     LIMIT 500
  LOOP
    IF p_enforce THEN
      IF anonymize_user(v_user) = 'anonymized' THEN v_count := v_count + 1; END IF;
    ELSE
      v_count := v_count + 1;
    END IF;
  END LOOP;
  rule := 'inactive_accounts'; affected := v_count; RETURN NEXT;
END
$$;

REVOKE ALL ON FUNCTION current_legal_version("LegalDocumentKind", timestamptz),
  publish_legal_document("LegalDocumentKind", integer, text, text, text, timestamptz),
  record_consent("LegalDocumentKind", integer, boolean, text), pending_consents(uuid),
  open_data_request("DataRequestKind", text),
  update_data_request(uuid, "DataRequestStatus", text), anonymize_user(uuid),
  execute_erasure(uuid, text), reveal_store_owner(uuid, text), apply_retention(boolean)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION current_legal_version("LegalDocumentKind", timestamptz),
  publish_legal_document("LegalDocumentKind", integer, text, text, text, timestamptz),
  record_consent("LegalDocumentKind", integer, boolean, text), pending_consents(uuid),
  open_data_request("DataRequestKind", text),
  update_data_request(uuid, "DataRequestStatus", text),
  execute_erasure(uuid, text), reveal_store_owner(uuid, text) TO duoshop_app;
-- anonymize_user et apply_retention : jamais appelables directement par le runtime ; le worker
-- les exécute avec sa connexion propriétaire, les demandes passent par execute_erasure.

-- ---------- Paramètres (durées À VALIDER PAR JURISTE, H9) ----------
INSERT INTO "ParameterDefinition" ("key", "kind", "ownerRole", "minValue", "maxValue", "labelFr", "labelEn") VALUES
  ('data_request.response_window', 'duration', 'COMPLIANCE', '1 day', '90 days',
   'Délai de réponse à une demande sur les données', 'Response time for a data request'),
  ('retention.notifications', 'duration', 'COMPLIANCE', '30 days', '10 years',
   'Conservation des notifications', 'Notification retention'),
  ('retention.sessions', 'duration', 'COMPLIANCE', '1 day', '5 years',
   'Conservation des sessions expirées', 'Expired session retention'),
  ('retention.inactive_account', 'duration', 'COMPLIANCE', '180 days', '20 years',
   'Anonymisation des comptes inactifs après', 'Inactive accounts anonymised after');
INSERT INTO "ParameterDefinition" ("key", "kind", "ownerRole", "labelFr", "labelEn") VALUES
  ('retention.mode', 'text', 'COMPLIANCE',
   'Purge : DRY_RUN (comptage seul) ou ENFORCE', 'Purge: DRY_RUN (count only) or ENFORCE');
INSERT INTO "RegulatoryParameter" ("id", "key", "value", "effectiveFrom", "legalBasis", "approvedAt") VALUES
  (gen_random_uuid(), 'data_request.response_window', '"30 days"', '2026-01-01T00:00:00Z',
   'Hypothèse H6. À valider par juriste.', now()),
  (gen_random_uuid(), 'retention.notifications', '"365 days"', '2026-01-01T00:00:00Z',
   'Hypothèse H9. À valider par juriste.', now()),
  (gen_random_uuid(), 'retention.sessions', '"90 days"', '2026-01-01T00:00:00Z',
   'Hypothèse H9. À valider par juriste.', now()),
  (gen_random_uuid(), 'retention.inactive_account', '"3 years"', '2026-01-01T00:00:00Z',
   'Hypothèse H9. À valider par juriste.', now()),
  (gen_random_uuid(), 'retention.mode', '"DRY_RUN"', '2026-01-01T00:00:00Z',
   'Exécution à blanc tant que les durées ne sont pas validées.', now());

-- ---------- Registre des traitements (version de départ, À VALIDER PAR JURISTE, H5) ----------
INSERT INTO "DataProcessingRegistry" ("key", "purposeFr", "purposeEn", "legalBasis", "dataCategories",
  "subjects", "recipients", "retentionParameter", "storageLocation", "security") VALUES
  ('accounts', 'Connexion et sécurité des comptes', 'Account sign-in and security', 'Contrat',
   'E-mail, identifiant chez le fournisseur d''identité, sessions', 'Acheteurs, vendeurs, personnel',
   'Fournisseur d''identité auto-hébergé', 'retention.inactive_account', 'Serveur de l''application',
   'Sessions opaques, MFA du personnel, RLS'),
  ('guest_carts', 'Achat sans compte', 'Shopping without an account', 'Intérêt légitime',
   'Empreinte de jeton, articles', 'Visiteurs', 'Aucun', 'guest_cart.retention',
   'Serveur de l''application', 'Empreinte seule du jeton, RLS'),
  ('orders', 'Exécution de la vente et livraison', 'Sale and delivery', 'Contrat',
   'Adresse, téléphone, repère, GPS facultatif', 'Acheteurs', 'Vendeur concerné, après paiement', NULL,
   'Serveur de l''application', 'RLS acheteur et vendeur, contact transmis après paiement'),
  ('payments', 'Encaissement et rapprochement', 'Collection and reconciliation', 'Contrat, obligation légale',
   'Montant, numéro payeur, références prestataire', 'Acheteurs', 'Prestataire de paiement', NULL,
   'Serveur de l''application', 'Statut relu chez le prestataire, journal immuable'),
  ('merchant_verification', 'Vérification des vendeurs', 'Seller verification', 'Obligation légale (hypothèse)',
   'Nom légal, propriétaire, téléphone, quartier', 'Vendeurs', 'Aucun', NULL,
   'Serveur de l''application', 'Consultation du contact privé journalisée avec motif'),
  ('claims', 'Réclamations et médiation', 'Claims and mediation', 'Contrat',
   'Motif, description, échanges', 'Acheteurs, vendeurs', 'Vendeur concerné', NULL,
   'Serveur de l''application', 'RLS, actions par fonctions dédiées'),
  ('notifications', 'Suivi des commandes', 'Order updates', 'Contrat',
   'Type d''événement, référence de commande', 'Acheteurs, vendeurs', 'Aucun', 'retention.notifications',
   'Serveur de l''application', 'RLS propriétaire'),
  ('data_requests', 'Droits des personnes', 'Data subject rights', 'Obligation légale (hypothèse)',
   'Demande, message, réponse', 'Toute personne inscrite', 'Aucun', 'data_request.response_window',
   'Serveur de l''application', 'RLS, traitement tracé');
