-- Lot 3 (ADR 0011) : modes d'encaissement sans détention de fonds de tiers.
-- PLATFORM_HELD (actuel, interdit en production sans autorisation à deux personnes),
-- DIRECT_SELLER (pilote : l'acheteur paie le compte marchand du vendeur, la plateforme constate une
-- créance de commission), PSP_ESCROW (cible : prestataire agréé). Le mode est figé sur chaque
-- paiement ; le journal et les remboursements en dépendent.
ALTER TABLE "Payment" ADD COLUMN "collectionMode" "CollectionMode" NOT NULL DEFAULT 'PLATFORM_HELD',
ADD COLUMN "storeAccountId" UUID;

CREATE TABLE "StorePaymentAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "credentials" BYTEA NOT NULL,
    "keyVersion" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StorePaymentAccount_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CollectionModeAuthorization" (
    "id" UUID NOT NULL,
    "mode" "CollectionMode" NOT NULL,
    "agrementReference" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "requestedBy" UUID NOT NULL,
    "requestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "CollectionModeAuthorization_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StorePaymentAccount_storeId_provider_key" ON "StorePaymentAccount"("storeId", "provider");

CREATE UNIQUE INDEX "StorePaymentAccount_tenantId_id_key" ON "StorePaymentAccount"("tenantId", "id");

ALTER TABLE "StorePaymentAccount" ADD CONSTRAINT "StorePaymentAccount_tenantId_storeId_fkey" FOREIGN KEY ("tenantId", "storeId") REFERENCES "Store"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payment" ADD CONSTRAINT "Payment_storeAccountId_fkey" FOREIGN KEY ("storeAccountId") REFERENCES "StorePaymentAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Écrit à la main ----------
ALTER TABLE "StorePaymentAccount" ADD CONSTRAINT "StorePaymentAccount_values_valid" CHECK (
  -- MOCK : simulateur de développement, refusé en production par l'adaptateur.
  "provider" ~ '^[a-z0-9_-]{2,40}$' AND "keyVersion" > 0
  AND ("mode" IN ('SANDBOX', 'LIVE') OR ("mode" = 'MOCK' AND "provider" = 'mock'))
  AND octet_length("credentials") BETWEEN 29 AND 4096);
ALTER TABLE "CollectionModeAuthorization" ADD CONSTRAINT "CollectionModeAuthorization_values_valid" CHECK (
  char_length("agrementReference") BETWEEN 5 AND 200
  AND ("approvedBy" IS NULL OR "approvedBy" <> "requestedBy")
  AND (("approvedBy" IS NULL) = ("approvedAt" IS NULL)));
-- Créance de commission sur un vendeur (mode direct) : suivie par vendeur, comme son dû.
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_seller_subaccount";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_seller_subaccount"
  CHECK (("account" IN ('SELLER_PAYABLE', 'COMMISSION_RECEIVABLE')) = ("tenantId" IS NOT NULL));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_collection_account" CHECK (
  ("collectionMode" = 'DIRECT_SELLER') = ("storeAccountId" IS NOT NULL));

-- Identifiants du compte marchand : chiffrés par l'application (clé hors base, versionnée) ; la
-- boutique les remplace, personne ne les relit en clair hors de l'adaptateur.
ALTER TABLE "StorePaymentAccount" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "StorePaymentAccount" USING ("tenantId" = app_tenant_id());
GRANT SELECT, INSERT ON "StorePaymentAccount" TO duoshop_app;
GRANT UPDATE ("mode", "credentials", "keyVersion", "active", "version", "updatedBy", "updatedAt")
  ON "StorePaymentAccount" TO duoshop_app;

-- Lecture d'un compte par son identifiant, hors contexte de boutique : notification et
-- rapprochement du prestataire, initiation du paiement par l'acheteur.
CREATE FUNCTION store_payment_account(p_account uuid)
RETURNS TABLE ("id" uuid, "storeId" uuid, "provider" text, "mode" "PaymentMode", "credentials" bytea,
  "keyVersion" integer, "active" boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a."id", a."storeId", a."provider", a."mode", a."credentials", a."keyVersion", a."active"
    FROM "StorePaymentAccount" a WHERE a."id" = p_account
$$;

-- Autorisation du mode « plateforme détentrice des fonds » : demandée par un ADMIN avec la
-- référence d'agrément, approuvée par une personne FINANCE distincte, limitée dans le temps.
ALTER TABLE "CollectionModeAuthorization" ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON "CollectionModeAuthorization" FOR SELECT
  USING (app_platform_role()::text IN ('ADMIN', 'FINANCE'));
GRANT SELECT ON "CollectionModeAuthorization" TO duoshop_app;

CREATE FUNCTION request_collection_authorization(p_mode "CollectionMode", p_reference text,
  p_expires timestamptz)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  IF app_platform_role()::text IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'authorization_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_expires IS NULL OR p_expires <= now() THEN
    RAISE EXCEPTION 'authorization_expired' USING ERRCODE = '22023';
  END IF;
  INSERT INTO "CollectionModeAuthorization" ("id", "mode", "agrementReference", "expiresAt", "requestedBy")
  VALUES (v_id, p_mode, btrim(p_reference), p_expires, app_user_id());
  INSERT INTO "ConfigAudit" ("id", "actorId", "entity", "entityId", "action", "after")
  VALUES (gen_random_uuid(), app_user_id(), 'CollectionModeAuthorization', v_id, 'request',
    jsonb_build_object('mode', p_mode, 'reference', btrim(p_reference), 'expiresAt', p_expires));
  RETURN v_id;
END
$$;

CREATE FUNCTION approve_collection_authorization(p_id uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a "CollectionModeAuthorization"%ROWTYPE;
BEGIN
  IF app_platform_role()::text IS DISTINCT FROM 'FINANCE' THEN RETURN 'forbidden'; END IF;
  SELECT * INTO a FROM "CollectionModeAuthorization" WHERE "id" = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF a."approvedAt" IS NOT NULL OR a."revokedAt" IS NOT NULL THEN RETURN 'already_decided'; END IF;
  IF a."requestedBy" = app_user_id() THEN RETURN 'same_person'; END IF;
  IF a."expiresAt" <= now() THEN RETURN 'expired'; END IF;
  UPDATE "CollectionModeAuthorization" SET "approvedBy" = app_user_id(), "approvedAt" = now()
   WHERE "id" = p_id;
  INSERT INTO "ConfigAudit" ("id", "actorId", "entity", "entityId", "action")
  VALUES (gen_random_uuid(), app_user_id(), 'CollectionModeAuthorization', p_id, 'approve');
  RETURN 'approved';
END
$$;

CREATE FUNCTION collection_mode_authorized(p_mode "CollectionMode")
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM "CollectionModeAuthorization"
                  WHERE "mode" = p_mode AND "approvedAt" IS NOT NULL AND "revokedAt" IS NULL
                    AND "expiresAt" > now())
$$;

-- Succès tardif (commande expirée, stock rendu) : le stock est repris s'il est encore disponible,
-- au même emplacement, par une mise à jour conditionnelle ; sinon rien ne change (comportement
-- d'avant : remboursement manuel). Tout ou rien, dans la transaction de apply_payment_event.
CREATE FUNCTION confirm_late_payment(p_order uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r record;
  v_buyer uuid;
  v_address jsonb;
BEGIN
  SELECT "buyerId", "addressSnapshot" INTO v_buyer, v_address FROM "Order" WHERE "id" = p_order;
  BEGIN
    FOR r IN
      SELECT i."quantity", i."variantId", i."tenantId", res."id" AS reservation_id, res."locationId"
        FROM "OrderItem" i
        JOIN "SellerOrder" so ON so."id" = i."sellerOrderId"
        JOIN "StockReservation" res ON res."tenantId" = i."tenantId" AND res."reference" = i."reservationRef"
       WHERE so."orderId" = p_order
    LOOP
      IF NOT variant_is_public(r."variantId") THEN
        RAISE EXCEPTION 'late_unavailable';
      END IF;
      UPDATE "StockLevel" SET "onHand" = "onHand" - r."quantity", "updatedAt" = now()
       WHERE "variantId" = r."variantId" AND "locationId" = r."locationId"
         AND "onHand" - "reserved" >= r."quantity";
      IF NOT FOUND THEN RAISE EXCEPTION 'late_unavailable'; END IF;
      UPDATE "StockReservation" SET "status" = 'CONSUMED', "releasedAt" = now()
       WHERE "id" = r.reservation_id;
      INSERT INTO "StockMovement" ("id", "tenantId", "variantId", "locationId", "delta", "reason",
        "note", "actorId", "idempotencyKey")
      VALUES (gen_random_uuid(), r."tenantId", r."variantId", r."locationId", -r."quantity", 'SALE',
        'late order ' || p_order::text, v_buyer, 'sale:' || r.reservation_id::text);
    END LOOP;
  EXCEPTION WHEN raise_exception THEN
    RETURN false;
  END;
  UPDATE "Order" SET "status" = 'PAID', "paidAt" = now(), "closedAt" = NULL WHERE "id" = p_order;
  UPDATE "SellerOrder" SET "status" = 'PAID',
         "deliveryContact" = CASE WHEN "deliveryMethod" = 'HOME_DELIVERY' THEN v_address END
   WHERE "orderId" = p_order;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION store_payment_account(uuid),
  request_collection_authorization("CollectionMode", text, timestamptz),
  approve_collection_authorization(uuid), collection_mode_authorized("CollectionMode"),
  confirm_late_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION store_payment_account(uuid),
  request_collection_authorization("CollectionMode", text, timestamptz),
  approve_collection_authorization(uuid), collection_mode_authorized("CollectionMode")
  TO duoshop_app;

-- ---------- Paramètres ----------
INSERT INTO "ParameterDefinition" ("key", "kind", "ownerRole", "labelFr", "labelEn") VALUES
  ('payment.late_success_autoconfirm', 'text', 'ADMIN',
   'Succès tardif : confirmer la commande si le stock est disponible (true/false)',
   'Late success: confirm the order when stock is available (true/false)');
INSERT INTO "RegulatoryParameter" ("id", "key", "value", "effectiveFrom", "legalBasis", "approvedAt") VALUES
  (gen_random_uuid(), 'payment.late_success_autoconfirm', '"true"', '2026-01-01T00:00:00Z',
   'Lot 3 : demandé par le porteur de projet le 9 novembre 2026.', now());
-- Durée d'une tentative portée à 15 minutes (demande du porteur de projet, lot 3) : nouvelle
-- période, la précédente est close à la même date (jamais modifiée).
UPDATE "RegulatoryParameter" SET "effectiveTo" = now()
 WHERE "key" = 'payment.attempt_window' AND "approvedAt" IS NOT NULL AND "effectiveTo" IS NULL;
INSERT INTO "RegulatoryParameter" ("id", "key", "value", "effectiveFrom", "legalBasis", "approvedAt") VALUES
  (gen_random_uuid(), 'payment.attempt_window', '"15 minutes"', now(),
   'Lot 3 : demandé par le porteur de projet le 9 novembre 2026. Hypothèse non validée.', now());

-- ---------- Fonctions modifiées (corps d'origine, changements ciblés) ----------
DROP FUNCTION start_payment(uuid, text, text, "PaymentMode", text, text);
CREATE FUNCTION start_payment(p_order uuid, p_method_code text, p_provider text,
  p_mode "PaymentMode", p_key text, p_phone text, p_collection_mode "CollectionMode",
  p_store_account uuid)
RETURNS TABLE (payment_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order "Order"%ROWTYPE;
  v_method "PaymentMethod"%ROWTYPE;
  v_previous "Payment"%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_order FROM "Order"
   WHERE "id" = p_order AND "buyerId" = app_user_id() FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, 'not_found'; RETURN;
  END IF;
  SELECT * INTO v_previous FROM "Payment" WHERE "orderId" = p_order AND "idempotencyKey" = p_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_previous."id",
      CASE WHEN v_previous."methodCode" = p_method_code
            AND v_previous."payerPhone" IS NOT DISTINCT FROM p_phone
           THEN 'replayed' ELSE 'conflict' END;
    RETURN;
  END IF;
  IF v_order."status" <> 'AWAITING_PAYMENT' THEN
    RETURN QUERY SELECT NULL::uuid, 'not_payable'; RETURN;
  END IF;
  IF v_order."expiresAt" <= now() THEN
    RETURN QUERY SELECT NULL::uuid, 'order_expired'; RETURN;
  END IF;
  SELECT * INTO v_method FROM "PaymentMethod"
   WHERE "code" = p_method_code AND "enabled" AND "provider" = p_provider
     AND "currency" = v_order."currency"
     AND v_order."totalMinor" >= "minAmountMinor"
     AND ("maxAmountMinor" IS NULL OR v_order."totalMinor" <= "maxAmountMinor");
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, 'method_unavailable'; RETURN;
  END IF;
  -- Mode direct (lot 3) : un seul vendeur par commande, payé sur son propre compte marchand.
  IF p_collection_mode = 'DIRECT_SELLER' THEN
    IF (SELECT count(*) FROM "SellerOrder" WHERE "orderId" = p_order) <> 1 THEN
      RETURN QUERY SELECT NULL::uuid, 'one_seller_per_order'; RETURN;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "StorePaymentAccount" a
                     JOIN "SellerOrder" so ON so."storeId" = a."storeId"
                    WHERE a."id" = p_store_account AND so."orderId" = p_order AND a."active") THEN
      RETURN QUERY SELECT NULL::uuid, 'seller_account_unavailable'; RETURN;
    END IF;
  ELSIF p_store_account IS NOT NULL THEN
    RETURN QUERY SELECT NULL::uuid, 'method_unavailable'; RETURN;
  END IF;
  -- Tentative sans réponse depuis plus que la durée paramétrée : expirée (un succès tardif reste honoré).
  UPDATE "Payment" SET "status" = 'EXPIRED', "failureCode" = 'attempt_timeout', "updatedAt" = now()
   WHERE "orderId" = p_order AND "status" = 'PENDING' AND "createdAt" < now() - param_interval('payment.attempt_window');
  SELECT * INTO v_previous FROM "Payment" WHERE "orderId" = p_order AND "status" = 'PENDING';
  IF FOUND THEN
    RETURN QUERY SELECT v_previous."id", 'payment_in_progress'; RETURN;
  END IF;
  INSERT INTO "Payment" ("id", "orderId", "buyerId", "methodId", "methodCode", "provider", "mode",
    "amountMinor", "currency", "idempotencyKey", "payerPhone", "collectionMode", "storeAccountId")
  VALUES (gen_random_uuid(), p_order, v_order."buyerId", v_method."id", v_method."code",
    v_method."provider", p_mode, v_order."totalMinor", v_order."currency", p_key, p_phone,
    p_collection_mode, p_store_account)
  RETURNING "id" INTO v_id;
  UPDATE "Order" SET "expiresAt" = greatest("expiresAt", now() + param_interval('payment.attempt_window'))
   WHERE "id" = p_order;
  UPDATE "StockReservation" SET "expiresAt" = greatest("expiresAt", now() + param_interval('payment.attempt_window'))
   WHERE "reference" LIKE 'order:' || p_order::text || ':%' AND "status" = 'ACTIVE';
  RETURN QUERY SELECT v_id, 'created';
END
$$;
REVOKE ALL ON FUNCTION start_payment(uuid, text, text, "PaymentMode", text, text, "CollectionMode", uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_payment(uuid, text, text, "PaymentMode", text, text, "CollectionMode", uuid) TO duoshop_app;

DROP FUNCTION apply_payment_event(text, text, text, jsonb, uuid, text, text, bigint, text, timestamptz, text);
CREATE FUNCTION apply_payment_event(p_provider text, p_event_id text, p_payload_hash text,
  p_payload jsonb, p_payment uuid, p_reference text, p_status text, p_amount bigint,
  p_currency text, p_occurred timestamptz, p_failure text, p_account uuid)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_payment "Payment"%ROWTYPE;
  v_order "Order"%ROWTYPE;
  v_outcome "ProviderEventOutcome";
  v_detail text;
  v_attention text;
  v_missing integer;
BEGIN
  IF p_status NOT IN ('SUCCEEDED', 'FAILED', 'PENDING') THEN
    RAISE EXCEPTION 'invalid payment event status' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_provider || ':' || p_event_id, 0));
  IF EXISTS (SELECT 1 FROM "ProviderEvent" WHERE "provider" = p_provider
               AND "eventId" = p_event_id AND "payloadHash" = p_payload_hash) THEN
    RETURN 'DUPLICATE';
  END IF;
  IF EXISTS (SELECT 1 FROM "ProviderEvent" WHERE "provider" = p_provider AND "eventId" = p_event_id) THEN
    v_outcome := 'QUARANTINED'; v_detail := 'event_id_reused';
  ELSE
    SELECT * INTO v_payment FROM "Payment"
     WHERE "id" = p_payment AND "provider" = p_provider FOR UPDATE;
    IF NOT FOUND THEN
      v_outcome := 'ORPHAN'; v_detail := 'unknown_payment';
    -- Mode direct (lot 3) : un événement vérifié avec les identifiants d'un vendeur ne vaut que
    -- pour les paiements de ce compte ; un paiement de la plateforme jamais par un compte vendeur.
    ELSIF v_payment."storeAccountId" IS DISTINCT FROM p_account THEN
      v_outcome := 'QUARANTINED'; v_detail := 'account_mismatch';
    ELSIF v_payment."providerReference" IS NOT NULL AND v_payment."providerReference" <> p_reference THEN
      v_outcome := 'QUARANTINED'; v_detail := 'reference_mismatch';
    ELSIF v_payment."amountMinor" <> p_amount OR v_payment."currency" <> p_currency THEN
      v_outcome := 'QUARANTINED'; v_detail := 'amount_mismatch'; v_attention := 'amount_mismatch';
    ELSIF p_status = 'PENDING' THEN
      v_outcome := 'IGNORED'; v_detail := 'informational';
      UPDATE "Payment" SET "providerReference" = coalesce("providerReference", p_reference)
       WHERE "id" = v_payment."id";
    ELSIF p_status = 'FAILED' THEN
      IF v_payment."status" = 'PENDING' THEN
        UPDATE "Payment" SET "status" = 'FAILED', "failureCode" = coalesce(p_failure, 'declined'),
               "providerReference" = coalesce("providerReference", p_reference),
               "settledAt" = now(), "updatedAt" = now()
         WHERE "id" = v_payment."id";
        v_outcome := 'APPLIED';
      ELSIF v_payment."status" = 'SUCCEEDED' THEN
        v_outcome := 'QUARANTINED'; v_detail := 'failure_after_success';
      ELSE
        v_outcome := 'IGNORED'; v_detail := 'already_closed';
      END IF;
    ELSIF v_payment."status" = 'SUCCEEDED' THEN
      v_outcome := 'IGNORED'; v_detail := 'already_succeeded';
    ELSE
      -- Succès, y compris après un échec ou une expiration locale : l'argent a été pris.
      UPDATE "Payment" SET "status" = 'SUCCEEDED', "failureCode" = NULL,
             "providerReference" = coalesce("providerReference", p_reference),
             "settledAt" = now(), "updatedAt" = now()
       WHERE "id" = v_payment."id";
      v_outcome := 'APPLIED';
      SELECT * INTO v_order FROM "Order" WHERE "id" = v_payment."orderId" FOR UPDATE;
      IF v_order."status" = 'PAID' THEN
        v_attention := 'duplicate_payment';
      ELSIF v_order."status" = 'EXPIRED'
            AND param_value('payment.late_success_autoconfirm') = 'true'
            AND confirm_late_payment(v_order."id") THEN
        -- Succès tardif, stock encore disponible : commande confirmée (lot 3, ADR 0011).
        v_detail := 'late_confirmed';
      ELSIF v_order."status" <> 'AWAITING_PAYMENT' THEN
        v_attention := 'order_closed';
      ELSE
        SELECT count(*) INTO v_missing
          FROM "OrderItem" i
          JOIN "SellerOrder" so ON so."id" = i."sellerOrderId"
          LEFT JOIN "StockReservation" r ON r."tenantId" = i."tenantId"
               AND r."reference" = i."reservationRef" AND r."status" = 'ACTIVE'
         WHERE so."orderId" = v_order."id" AND r."id" IS NULL;
        IF v_missing > 0 THEN
          v_attention := 'stock_released';
        ELSE
          WITH consumed AS (
            UPDATE "StockReservation" r
               SET "status" = 'CONSUMED', "releasedAt" = now()
              FROM "OrderItem" i JOIN "SellerOrder" so ON so."id" = i."sellerOrderId"
             WHERE so."orderId" = v_order."id" AND r."tenantId" = i."tenantId"
               AND r."reference" = i."reservationRef" AND r."status" = 'ACTIVE'
            RETURNING r."id", r."tenantId", r."variantId", r."locationId", r."quantity"
          ), moved AS (
            INSERT INTO "StockMovement" ("id", "tenantId", "variantId", "locationId", "delta",
              "reason", "note", "actorId", "idempotencyKey")
            SELECT gen_random_uuid(), c."tenantId", c."variantId", c."locationId", -c."quantity",
                   'SALE'::"StockMovementReason", 'order ' || v_order."id"::text, v_order."buyerId", 'sale:' || c."id"::text
              FROM consumed c
            RETURNING 1
          ), totals AS (
            SELECT "variantId", "locationId", sum("quantity")::integer AS quantity
              FROM consumed GROUP BY "variantId", "locationId"
          )
          UPDATE "StockLevel" s
             SET "onHand" = s."onHand" - t.quantity, "reserved" = s."reserved" - t.quantity,
                 "updatedAt" = now()
            FROM totals t
           WHERE s."variantId" = t."variantId" AND s."locationId" = t."locationId";
          UPDATE "Order" SET "status" = 'PAID', "paidAt" = now() WHERE "id" = v_order."id";
          UPDATE "SellerOrder" SET "status" = 'PAID',
                 "deliveryContact" = CASE WHEN "deliveryMethod" = 'HOME_DELIVERY'
                                          THEN v_order."addressSnapshot" END
           WHERE "orderId" = v_order."id";
        END IF;
      END IF;
    END IF;
  END IF;
  IF v_attention IS NOT NULL THEN
    UPDATE "Payment" SET "attentionReason" = coalesce("attentionReason", v_attention), "updatedAt" = now()
     WHERE "id" = v_payment."id";
    v_detail := coalesce(v_detail, v_attention);
  END IF;
  INSERT INTO "ProviderEvent" ("id", "provider", "eventId", "payloadHash", "payload", "paymentId",
    "reportedStatus", "amountMinor", "currency", "occurredAt", "outcome", "detail")
  VALUES (gen_random_uuid(), p_provider, p_event_id, p_payload_hash, p_payload, v_payment."id",
    p_status, p_amount, p_currency, p_occurred, v_outcome, v_detail);
  RETURN v_outcome::text;
END
$$;
REVOKE ALL ON FUNCTION apply_payment_event(text, text, text, jsonb, uuid, text, text, bigint, text, timestamptz, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_payment_event(text, text, text, jsonb, uuid, text, text, bigint, text, timestamptz, text, uuid) TO duoshop_app;

-- Compte marchand du vendeur d'une commande de l'acheteur courant (mode direct, un seul vendeur).
CREATE FUNCTION order_payment_account(p_order uuid, p_provider text)
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a."id" FROM "Order" o
    JOIN "SellerOrder" so ON so."orderId" = o."id"
    JOIN "StorePaymentAccount" a ON a."storeId" = so."storeId" AND a."provider" = p_provider AND a."active"
   WHERE o."id" = p_order AND o."buyerId" = app_user_id()
     AND (SELECT count(*) FROM "SellerOrder" WHERE "orderId" = p_order) = 1
$$;
REVOKE ALL ON FUNCTION order_payment_account(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION order_payment_account(uuid, text) TO duoshop_app;

CREATE OR REPLACE FUNCTION book_seller_order_paid(p_seller_order uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_so "SellerOrder"%ROWTYPE;
  v_rule "CommissionRule"%ROWTYPE;
  v_currency text;
  v_bp integer;
  v_commission bigint;
  v_net bigint;
  v_mode "CollectionMode";
BEGIN
  SELECT * INTO v_so FROM "SellerOrder" WHERE "id" = p_seller_order;
  SELECT "currency" INTO v_currency FROM "Order" WHERE "id" = v_so."orderId";
  SELECT * INTO v_rule FROM "CommissionRule" r
   WHERE (r."storeId" = v_so."storeId" OR r."storeId" IS NULL)
     AND r."validFrom" <= now() AND (r."validTo" IS NULL OR r."validTo" > now())
   ORDER BY (r."storeId" IS NULL), r."validFrom" DESC
   LIMIT 1;
  v_bp := coalesce(v_rule."basisPoints", 0);
  -- Base : articles seuls (la livraison revient au vendeur qui livre). Arrondi half-up.
  v_commission := (v_so."itemsTotalMinor" * v_bp + 5000) / 10000;
  v_net := v_so."itemsTotalMinor" + v_so."deliveryFeeMinor" - v_commission;
  UPDATE "SellerOrder"
     SET "commissionRuleId" = v_rule."id", "commissionBasisPoints" = v_bp,
         "commissionBaseMinor" = v_so."itemsTotalMinor", "commissionMinor" = v_commission,
         "sellerNetMinor" = v_net
   WHERE "id" = v_so."id";
  -- Mode du paiement qui a confirmé la commande (lot 3) : en mode direct, l'argent est chez le
  -- vendeur ; la plateforme ne constate qu'une créance de commission sur lui.
  SELECT p."collectionMode" INTO v_mode FROM "Payment" p
   WHERE p."orderId" = v_so."orderId" AND p."status" = 'SUCCEEDED' AND p."attentionReason" IS NULL
   ORDER BY p."settledAt" LIMIT 1;
  IF v_mode = 'DIRECT_SELLER' THEN
    PERFORM post_journal('order_paid', v_so."id"::text, v_currency,
      'Vente encaissée par le vendeur — ' || v_so."storeName" || ' — ' || upper(left(v_so."orderId"::text, 8)),
      jsonb_build_array(
        jsonb_build_object('account', 'COMMISSION_RECEIVABLE', 'tenantId', v_so."tenantId", 'amount', v_commission),
        jsonb_build_object('account', 'COMMISSION_DEFERRED', 'amount', -v_commission)));
    RETURN;
  END IF;
  PERFORM post_journal('order_paid', v_so."id"::text, v_currency,
    'Paiement confirmé — ' || v_so."storeName" || ' — ' || upper(left(v_so."orderId"::text, 8)),
    jsonb_build_array(
      jsonb_build_object('account', 'PSP_CLEARING', 'amount', v_net + v_commission),
      jsonb_build_object('account', 'SELLER_PAYABLE', 'tenantId', v_so."tenantId", 'amount', -v_net),
      jsonb_build_object('account', 'COMMISSION_DEFERRED', 'amount', -v_commission)));
END
$$;

CREATE OR REPLACE FUNCTION decide_refund(p_claim uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_c "Claim"%ROWTYPE;
  v_so "SellerOrder"%ROWTYPE;
  v_paid bigint;
  v_refunded bigint;
  v_remaining_commission bigint;
  v_reversal bigint;
  v_refund uuid := gen_random_uuid();
  v_payment uuid;
  v_mode "CollectionMode";
BEGIN
  SELECT * INTO v_c FROM "Claim" WHERE "id" = p_claim;
  SELECT * INTO v_so FROM "SellerOrder" WHERE "id" = v_c."sellerOrderId" FOR UPDATE;
  SELECT "totalMinor" INTO v_paid FROM "Order" WHERE "id" = v_c."orderId";
  SELECT coalesce(sum("amountMinor"), 0) INTO v_refunded FROM "Refund" WHERE "orderId" = v_c."orderId";
  IF v_refunded + v_c."amountMinor" > v_paid THEN
    RAISE EXCEPTION 'refund exceeds captured amount' USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(v_so."commissionMinor", 0) - coalesce(sum("commissionReversedMinor"), 0)
    INTO v_remaining_commission FROM "Refund" WHERE "claimId" IN (
      SELECT "id" FROM "Claim" WHERE "sellerOrderId" = v_so."id");
  v_reversal := least((v_c."amountMinor" * coalesce(v_so."commissionBasisPoints", 0) + 5000) / 10000,
                      greatest(v_remaining_commission, 0));
  SELECT "id" INTO v_payment FROM "Payment"
   WHERE "orderId" = v_c."orderId" AND "status" = 'SUCCEEDED' AND "attentionReason" IS NULL
   ORDER BY "settledAt" LIMIT 1;
  SELECT "collectionMode" INTO v_mode FROM "Payment" WHERE "id" = v_payment;
  -- Mode direct (lot 3) : le vendeur détient l'argent et exécute le remboursement lui-même.
  INSERT INTO "Refund" ("id", "claimId", "tenantId", "orderId", "buyerId", "paymentId", "amountMinor",
    "commissionReversedMinor", "sellerDebitMinor", "currency", "status")
  VALUES (v_refund, v_c."id", v_c."tenantId", v_c."orderId", v_c."buyerId", v_payment, v_c."amountMinor",
    v_reversal, v_c."amountMinor" - v_reversal, v_c."currency",
    CASE WHEN v_mode = 'DIRECT_SELLER' THEN 'SELLER_TO_EXECUTE' ELSE 'PENDING_PROVIDER' END::"RefundStatus");
  IF v_mode = 'DIRECT_SELLER' THEN
    -- Seule la commission reprise touche la plateforme : la créance sur le vendeur diminue.
    PERFORM post_journal('refund_decided', v_refund::text, v_c."currency",
      'Remboursement à exécuter par le vendeur — ' || v_so."storeName" || ' — ' || upper(left(v_c."orderId"::text, 8)),
      jsonb_build_array(
        jsonb_build_object('account', 'COMMISSION_REVENUE', 'amount', v_reversal),
        jsonb_build_object('account', 'COMMISSION_RECEIVABLE', 'tenantId', v_c."tenantId", 'amount', -v_reversal)));
    RETURN;
  END IF;
  PERFORM post_journal('refund_decided', v_refund::text, v_c."currency",
    'Remboursement décidé — ' || v_so."storeName" || ' — ' || upper(left(v_c."orderId"::text, 8)),
    jsonb_build_array(
      jsonb_build_object('account', 'SELLER_PAYABLE', 'tenantId', v_c."tenantId",
                         'amount', v_c."amountMinor" - v_reversal),
      jsonb_build_object('account', 'COMMISSION_REVENUE', 'amount', v_reversal),
      jsonb_build_object('account', 'REFUND_PAYABLE', 'amount', -v_c."amountMinor")));
END
$$;

CREATE OR REPLACE FUNCTION on_payment_unapplied() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Mode direct : l'argent est chez le vendeur, pas chez la plateforme (signalement seul).
  IF NEW."collectionMode" = 'DIRECT_SELLER' THEN RETURN NULL; END IF;
  PERFORM post_journal('unapplied_payment', NEW."id"::text, NEW."currency",
    'Paiement à rembourser (' || NEW."attentionReason" || ') — ' || NEW."methodCode",
    jsonb_build_array(
      jsonb_build_object('account', 'PSP_CLEARING', 'amount', NEW."amountMinor"),
      jsonb_build_object('account', 'REFUND_PAYABLE', 'amount', -NEW."amountMinor")));
  RETURN NULL;
END
$$;

DROP FUNCTION pending_provider_payments(text, boolean, integer);
CREATE FUNCTION pending_provider_payments(p_provider text, p_include_old boolean, p_limit integer)
RETURNS TABLE ("id" uuid, "providerReference" text, "storeAccountId" uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p."id", p."providerReference", p."storeAccountId"
    FROM "Payment" p
   WHERE p."provider" = p_provider
     AND p."status" IN ('PENDING', 'EXPIRED')
     AND p."providerReference" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "ProviderEvent" e
                      WHERE e."paymentId" = p."id" AND e."reportedStatus" IN ('SUCCEEDED', 'FAILED'))
     AND p."createdAt" < now() - interval '1 minute'
     AND p."createdAt" > now() - CASE WHEN p_include_old THEN interval '25 hours'
                                      ELSE interval '30 minutes' END
   ORDER BY p."createdAt"
   LIMIT least(greatest(p_limit, 0), 100)
$$;
REVOKE ALL ON FUNCTION pending_provider_payments(text, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_provider_payments(text, boolean, integer) TO duoshop_app;
