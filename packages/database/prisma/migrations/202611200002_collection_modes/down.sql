-- Retour arrière du lot 3 : refusé dès qu'un paiement direct, un compte marchand ou une
-- autorisation existe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Payment" WHERE "collectionMode" <> 'PLATFORM_HELD' OR "storeAccountId" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM "StorePaymentAccount")
     OR EXISTS (SELECT 1 FROM "CollectionModeAuthorization") THEN
    RAISE EXCEPTION 'down refused: collection modes are in use';
  END IF;
END
$$;
DROP FUNCTION start_payment(uuid, text, text, "PaymentMode", text, text, "CollectionMode", uuid);
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
  -- Tentative sans réponse depuis plus que la durée paramétrée : expirée (un succès tardif reste honoré).
  UPDATE "Payment" SET "status" = 'EXPIRED', "failureCode" = 'attempt_timeout', "updatedAt" = now()
   WHERE "orderId" = p_order AND "status" = 'PENDING' AND "createdAt" < now() - param_interval('payment.attempt_window');
  SELECT * INTO v_previous FROM "Payment" WHERE "orderId" = p_order AND "status" = 'PENDING';
  IF FOUND THEN
    RETURN QUERY SELECT v_previous."id", 'payment_in_progress'; RETURN;
  END IF;
  INSERT INTO "Payment" ("id", "orderId", "buyerId", "methodId", "methodCode", "provider", "mode",
    "amountMinor", "currency", "idempotencyKey", "payerPhone")
  VALUES (gen_random_uuid(), p_order, v_order."buyerId", v_method."id", v_method."code",
    v_method."provider", p_mode, v_order."totalMinor", v_order."currency", p_key, p_phone)
  RETURNING "id" INTO v_id;
  UPDATE "Order" SET "expiresAt" = greatest("expiresAt", now() + param_interval('payment.attempt_window'))
   WHERE "id" = p_order;
  UPDATE "StockReservation" SET "expiresAt" = greatest("expiresAt", now() + param_interval('payment.attempt_window'))
   WHERE "reference" LIKE 'order:' || p_order::text || ':%' AND "status" = 'ACTIVE';
  RETURN QUERY SELECT v_id, 'created';
END
$$;
REVOKE ALL ON FUNCTION start_payment(uuid, text, text, "PaymentMode", text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_payment(uuid, text, text, "PaymentMode", text, text) TO duoshop_app;

DROP FUNCTION order_payment_account(uuid, text);
DROP FUNCTION apply_payment_event(text, text, text, jsonb, uuid, text, text, bigint, text, timestamptz, text, uuid);
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
REVOKE ALL ON FUNCTION apply_payment_event(text, text, text, jsonb, uuid, text, text, bigint, text, timestamptz, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_payment_event(text, text, text, jsonb, uuid, text, text, bigint, text, timestamptz, text) TO duoshop_app;

CREATE OR REPLACE FUNCTION book_seller_order_paid(p_seller_order uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_so "SellerOrder"%ROWTYPE;
  v_rule "CommissionRule"%ROWTYPE;
  v_currency text;
  v_bp integer;
  v_commission bigint;
  v_net bigint;
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
  INSERT INTO "Refund" ("id", "claimId", "tenantId", "orderId", "buyerId", "paymentId", "amountMinor",
    "commissionReversedMinor", "sellerDebitMinor", "currency")
  VALUES (v_refund, v_c."id", v_c."tenantId", v_c."orderId", v_c."buyerId", v_payment, v_c."amountMinor",
    v_reversal, v_c."amountMinor" - v_reversal, v_c."currency");
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
RETURNS TABLE ("id" uuid, "providerReference" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p."id", p."providerReference"
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

ALTER TABLE "LedgerEntry" DROP CONSTRAINT "LedgerEntry_seller_subaccount";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_seller_subaccount"
  CHECK (("account" = 'SELLER_PAYABLE') = ("tenantId" IS NOT NULL));
DROP FUNCTION confirm_late_payment(uuid);
DROP FUNCTION collection_mode_authorized("CollectionMode");
DROP FUNCTION approve_collection_authorization(uuid);
DROP FUNCTION request_collection_authorization("CollectionMode", text, timestamptz);
DROP FUNCTION store_payment_account(uuid);
DROP TABLE "CollectionModeAuthorization";
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_storeAccountId_fkey";
ALTER TABLE "Payment" DROP COLUMN "storeAccountId", DROP COLUMN "collectionMode";
DROP TABLE "StorePaymentAccount";
-- Délai de tentative : retour à la valeur d'origine (période ouverte par ce lot supprimée).
DELETE FROM "RegulatoryParameter" WHERE "key" = 'payment.attempt_window' AND "legalBasis" LIKE 'Lot 3%';
UPDATE "RegulatoryParameter" SET "effectiveTo" = NULL
 WHERE "key" = 'payment.attempt_window' AND "proposedBy" IS NULL
   AND "effectiveTo" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "RegulatoryParameter" r2 WHERE r2."key" = 'payment.attempt_window'
                     AND r2."effectiveFrom" > "RegulatoryParameter"."effectiveFrom" AND r2."approvedAt" IS NOT NULL);
DELETE FROM "RegulatoryParameter" WHERE "key" = 'payment.late_success_autoconfirm';
DELETE FROM "ParameterDefinition" WHERE "key" = 'payment.late_success_autoconfirm';
