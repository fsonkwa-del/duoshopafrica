-- CreateEnum
CREATE TYPE "PaymentMethodKind" AS ENUM ('MOBILE_MONEY', 'CARD', 'BANK_TRANSFER', 'WALLET');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('MOCK', 'SANDBOX', 'LIVE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ProviderEventOutcome" AS ENUM ('APPLIED', 'DUPLICATE', 'QUARANTINED', 'ORPHAN', 'IGNORED');

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'PAID';

-- AlterEnum
ALTER TYPE "StockMovementReason" ADD VALUE 'SALE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "SellerOrder" ADD COLUMN     "deliveryContact" JSONB;

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PaymentMethodKind" NOT NULL,
    "operator" TEXT,
    "provider" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "labelFr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,
    "instructionsFr" TEXT,
    "instructionsEn" TEXT,
    "phonePrefixes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minAmountMinor" BIGINT NOT NULL DEFAULT 1,
    "maxAmountMinor" BIGINT,
    "displayOrder" INTEGER NOT NULL DEFAULT 100,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "methodId" UUID NOT NULL,
    "methodCode" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" "PaymentMode" NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "idempotencyKey" TEXT NOT NULL,
    "payerPhone" TEXT,
    "providerReference" TEXT,
    "nextAction" JSONB,
    "failureCode" TEXT,
    "attentionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMPTZ(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderEvent" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payloadHash" CHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "paymentId" UUID,
    "reportedStatus" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" "ProviderEventOutcome" NOT NULL,
    "detail" TEXT,

    CONSTRAINT "ProviderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConfigAudit" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConfigAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_code_key" ON "PaymentMethod"("code");

-- CreateIndex
CREATE INDEX "PaymentMethod_countryCode_currency_enabled_idx" ON "PaymentMethod"("countryCode", "currency", "enabled");

-- CreateIndex
CREATE INDEX "Payment_orderId_createdAt_idx" ON "Payment"("orderId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_orderId_idempotencyKey_key" ON "Payment"("orderId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_providerReference_key" ON "Payment"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "ProviderEvent_outcome_receivedAt_idx" ON "ProviderEvent"("outcome", "receivedAt");

-- CreateIndex
CREATE INDEX "ProviderEvent_paymentId_idx" ON "ProviderEvent"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderEvent_provider_eventId_payloadHash_key" ON "ProviderEvent"("provider", "eventId", "payloadHash");

-- CreateIndex
CREATE INDEX "ConfigAudit_entity_entityId_createdAt_idx" ON "ConfigAudit"("entity", "entityId", "createdAt");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_methodId_fkey" FOREIGN KEY ("methodId") REFERENCES "PaymentMethod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderEvent" ADD CONSTRAINT "ProviderEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------- Écrit à la main : invariants, RLS, fonctions de paiement ----------
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_values_valid" CHECK (
  "code" ~ '^[A-Z0-9_]{2,40}$'
  AND "provider" ~ '^[a-z0-9_-]{2,40}$'
  AND ("operator" IS NULL OR "operator" ~ '^[A-Z0-9_]{2,30}$')
  AND "countryCode" ~ '^[A-Z]{2}$'
  AND "currency" ~ '^[A-Z]{3}$'
  AND char_length("labelFr") BETWEEN 1 AND 80
  AND char_length("labelEn") BETWEEN 1 AND 80
  AND char_length(coalesce("instructionsFr", '')) <= 300
  AND char_length(coalesce("instructionsEn", '')) <= 300
  AND array_to_string(coalesce("phonePrefixes", ARRAY[]::text[]), ',') ~ '^(\+[1-9][0-9]{1,7}(,\+[1-9][0-9]{1,7})*)?$'
  AND "minAmountMinor" >= 1
  AND ("maxAmountMinor" IS NULL OR "maxAmountMinor" >= "minAmountMinor"));
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_values_valid" CHECK (
  "amountMinor" > 0
  AND ("payerPhone" IS NULL OR "payerPhone" ~ '^\+[1-9][0-9]{7,14}$')
  AND char_length("idempotencyKey") BETWEEN 16 AND 64);

-- RLS. Catalogue des moyens : lisible par tous, modifiable par un ADMIN plateforme seulement.
ALTER TABLE "PaymentMethod" ENABLE ROW LEVEL SECURITY;
CREATE POLICY public_read ON "PaymentMethod" FOR SELECT USING (true);
CREATE POLICY admin_insert ON "PaymentMethod" FOR INSERT WITH CHECK (app_platform_role() = 'ADMIN');
CREATE POLICY admin_update ON "PaymentMethod" FOR UPDATE
  USING (app_platform_role() = 'ADMIN') WITH CHECK (app_platform_role() = 'ADMIN');
GRANT SELECT, INSERT ON "PaymentMethod" TO duoshop_app;
GRANT UPDATE ("kind", "operator", "provider", "countryCode", "currency", "labelFr", "labelEn",
  "instructionsFr", "instructionsEn", "phonePrefixes", "minAmountMinor", "maxAmountMinor",
  "displayOrder", "enabled", "version", "updatedAt") ON "PaymentMethod" TO duoshop_app;

-- Paiements et événements : lecture par l'acheteur (ses paiements) et le personnel ;
-- toute écriture passe par les fonctions ci-dessous.
ALTER TABLE "Payment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY buyer_scope ON "Payment" FOR SELECT USING ("buyerId" = app_user_id());
CREATE POLICY staff_read ON "Payment" FOR SELECT USING (app_platform_role() IS NOT NULL);
ALTER TABLE "ProviderEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON "ProviderEvent" FOR SELECT USING (app_platform_role() IS NOT NULL);
ALTER TABLE "ConfigAudit" ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON "ConfigAudit" FOR SELECT USING (app_platform_role() IS NOT NULL);
CREATE POLICY admin_insert ON "ConfigAudit" FOR INSERT
  WITH CHECK (app_platform_role() = 'ADMIN' AND "actorId" = app_user_id());
GRANT SELECT ON "Payment", "ProviderEvent" TO duoshop_app;
GRANT SELECT, INSERT ON "ConfigAudit" TO duoshop_app;
-- Le personnel lit les sous-commandes pour le suivi des paiements à traiter.
CREATE POLICY staff_read ON "Order" FOR SELECT USING (app_platform_role() IS NOT NULL);

-- Ouverture d'une tentative de paiement par l'acheteur. Verrou sur la commande : au plus une
-- tentative en cours ; même clé => rejeu ; une tentative en cours prolonge la réservation de
-- 10 minutes pour qu'une validation sur téléphone en fin de fenêtre trouve encore le stock.
CREATE FUNCTION start_payment(p_order uuid, p_method_code text, p_provider text,
  p_mode "PaymentMode", p_key text, p_phone text)
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
  -- Tentative sans réponse depuis plus de 10 minutes : expirée (un succès tardif reste honoré).
  UPDATE "Payment" SET "status" = 'EXPIRED', "failureCode" = 'attempt_timeout', "updatedAt" = now()
   WHERE "orderId" = p_order AND "status" = 'PENDING' AND "createdAt" < now() - interval '10 minutes';
  SELECT * INTO v_previous FROM "Payment" WHERE "orderId" = p_order AND "status" = 'PENDING';
  IF FOUND THEN
    RETURN QUERY SELECT v_previous."id", 'payment_in_progress'; RETURN;
  END IF;
  INSERT INTO "Payment" ("id", "orderId", "buyerId", "methodId", "methodCode", "provider", "mode",
    "amountMinor", "currency", "idempotencyKey", "payerPhone")
  VALUES (gen_random_uuid(), p_order, v_order."buyerId", v_method."id", v_method."code",
    v_method."provider", p_mode, v_order."totalMinor", v_order."currency", p_key, p_phone)
  RETURNING "id" INTO v_id;
  UPDATE "Order" SET "expiresAt" = greatest("expiresAt", now() + interval '10 minutes')
   WHERE "id" = p_order;
  UPDATE "StockReservation" SET "expiresAt" = greatest("expiresAt", now() + interval '10 minutes')
   WHERE "reference" LIKE 'order:' || p_order::text || ':%' AND "status" = 'ACTIVE';
  RETURN QUERY SELECT v_id, 'created';
END
$$;

-- Résultat de l'appel d'initiation chez le prestataire (référence et action suivante, ou échec).
CREATE FUNCTION record_payment_initiation(p_payment uuid, p_reference text, p_next_action jsonb,
  p_failure text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_failure IS NOT NULL THEN
    UPDATE "Payment" SET "status" = 'FAILED', "failureCode" = p_failure, "updatedAt" = now()
     WHERE "id" = p_payment AND "buyerId" = app_user_id() AND "status" = 'PENDING'
       AND "providerReference" IS NULL;
  ELSE
    UPDATE "Payment" SET "providerReference" = p_reference, "nextAction" = p_next_action,
           "updatedAt" = now()
     WHERE "id" = p_payment AND "buyerId" = app_user_id() AND "providerReference" IS NULL;
  END IF;
  RETURN FOUND;
END
$$;

-- Application d'un webhook DÉJÀ VÉRIFIÉ (signature, fraîcheur) par l'API. Persistance de
-- l'événement et de son effet dans la même transaction ; l'ACK n'est envoyé qu'après.
-- Doublon exact => DUPLICATE sans effet ; même identifiant, autre contenu => QUARANTINED.
-- Succès : commande PAID, réservations consommées (vente), contact de livraison transmis.
-- Succès impossible à honorer (commande close, déjà payée, stock libéré) => attentionReason.
CREATE FUNCTION apply_payment_event(p_provider text, p_event_id text, p_payload_hash text,
  p_payload jsonb, p_payment uuid, p_reference text, p_status text, p_amount bigint,
  p_currency text, p_occurred timestamptz, p_failure text)
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

-- Clôture d'une commande non payée : inchangée, sauf deux règles de paiement :
-- pas d'annulation pendant une tentative récente (le payeur valide peut-être sur son téléphone),
-- et les tentatives restantes expirent avec la commande.
CREATE OR REPLACE FUNCTION close_unpaid_order(p_order uuid, p_status "OrderStatus")
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status = 'CANCELLED' THEN
    UPDATE "Order" SET "status" = 'CANCELLED', "closedAt" = now()
     WHERE "id" = p_order AND "status" = 'AWAITING_PAYMENT' AND "buyerId" = app_user_id()
       AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = p_order
                         AND p."status" = 'PENDING' AND p."createdAt" >= now() - interval '10 minutes');
  ELSIF p_status = 'EXPIRED' THEN
    UPDATE "Order" SET "status" = 'EXPIRED', "closedAt" = now()
     WHERE "id" = p_order AND "status" = 'AWAITING_PAYMENT' AND "expiresAt" < now();
  ELSE
    RAISE EXCEPTION 'invalid closing status' USING ERRCODE = '22023';
  END IF;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  UPDATE "SellerOrder" SET "status" = p_status WHERE "orderId" = p_order;
  UPDATE "Payment" SET "status" = 'EXPIRED', "failureCode" = 'order_closed', "updatedAt" = now()
   WHERE "orderId" = p_order AND "status" = 'PENDING';
  WITH released AS (
    UPDATE "StockReservation" r
       SET "status" = 'RELEASED', "releasedAt" = now()
     WHERE r."reference" LIKE 'order:' || p_order::text || ':%' AND r."status" = 'ACTIVE'
    RETURNING r."variantId", r."locationId", r."quantity"
  ), totals AS (
    SELECT "variantId", "locationId", sum("quantity")::integer AS quantity
      FROM released GROUP BY "variantId", "locationId"
  )
  UPDATE "StockLevel" s
     SET "reserved" = s."reserved" - t.quantity, "updatedAt" = now()
    FROM totals t
   WHERE s."variantId" = t."variantId" AND s."locationId" = t."locationId";
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION start_payment(uuid, text, text, "PaymentMode", text, text),
  record_payment_initiation(uuid, text, jsonb, text),
  apply_payment_event(text, text, text, jsonb, uuid, text, text, bigint, text, timestamptz, text)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_payment(uuid, text, text, "PaymentMode", text, text),
  record_payment_initiation(uuid, text, jsonb, text),
  apply_payment_event(text, text, text, jsonb, uuid, text, text, bigint, text, timestamptz, text)
  TO duoshop_app;
