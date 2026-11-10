-- Retour arrière du lot 0 : constantes d'origine, puis suppression des paramètres.
-- Refusé si une valeur a été saisie par une personne : on n'efface jamais une décision en silence.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "RegulatoryParameter" WHERE "proposedBy" IS NOT NULL) THEN
    RAISE EXCEPTION 'down refused: RegulatoryParameter holds values entered by staff';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION start_payment(p_order uuid, p_method_code text, p_provider text,
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

CREATE OR REPLACE FUNCTION open_claim(p_seller_order uuid, p_reason "ClaimReason", p_description text,
  p_items jsonb, p_key text)
RETURNS TABLE (claim_id uuid, outcome text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_so "SellerOrder"%ROWTYPE;
  v_buyer uuid;
  v_currency text;
  v_previous "Claim"%ROWTYPE;
  v_claim uuid := gen_random_uuid();
  v_line record;
  v_total bigint := 0;
BEGIN
  SELECT so.* INTO v_so FROM "SellerOrder" so JOIN "Order" o ON o."id" = so."orderId"
   WHERE so."id" = p_seller_order AND o."buyerId" = app_user_id() FOR UPDATE OF so;
  IF NOT FOUND THEN RETURN QUERY SELECT NULL::uuid, 'not_found'; RETURN; END IF;
  SELECT "buyerId", "currency" INTO v_buyer, v_currency FROM "Order" WHERE "id" = v_so."orderId";
  SELECT * INTO v_previous FROM "Claim" WHERE "buyerId" = v_buyer AND "idempotencyKey" = p_key;
  IF FOUND THEN
    RETURN QUERY SELECT v_previous."id",
      CASE WHEN v_previous."sellerOrderId" = p_seller_order THEN 'replayed' ELSE 'conflict' END;
    RETURN;
  END IF;
  IF v_so."fulfilmentStatus" <> 'DELIVERED' OR v_so."deliveredAt" < now() - interval '7 days' THEN
    RETURN QUERY SELECT NULL::uuid, 'window_closed'; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "Claim" WHERE "sellerOrderId" = v_so."id"
              AND "status" IN ('OPEN', 'REJECTED', 'ESCALATED')) THEN
    RETURN QUERY SELECT NULL::uuid, 'claim_in_progress'; RETURN;
  END IF;
  IF char_length(btrim(coalesce(p_description, ''))) < 10 THEN
    RETURN QUERY SELECT NULL::uuid, 'description_required'; RETURN;
  END IF;
  IF jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0
     OR (SELECT count(DISTINCT l->>'orderItemId') FROM jsonb_array_elements(p_items) l) <> jsonb_array_length(p_items) THEN
    RETURN QUERY SELECT NULL::uuid, 'invalid_items'; RETURN;
  END IF;
  FOR v_line IN
    SELECT i."id", i."unitPriceMinor", i."quantity" AS ordered, (l->>'quantity')::integer AS wanted,
           coalesce((SELECT sum(ci."quantity") FROM "ClaimItem" ci JOIN "Claim" c ON c."id" = ci."claimId"
                      WHERE ci."orderItemId" = i."id" AND c."status" IN ('ACCEPTED', 'REFUND_APPROVED')), 0) AS refunded
      FROM jsonb_array_elements(p_items) l
      LEFT JOIN "OrderItem" i ON i."id" = (l->>'orderItemId')::uuid AND i."sellerOrderId" = v_so."id"
  LOOP
    IF v_line."id" IS NULL OR v_line.wanted IS NULL OR v_line.wanted < 1 THEN
      RETURN QUERY SELECT NULL::uuid, 'invalid_items'; RETURN;
    END IF;
    IF v_line.wanted > v_line.ordered - v_line.refunded THEN
      RETURN QUERY SELECT NULL::uuid, 'quantity_exceeded'; RETURN;
    END IF;
    v_total := v_total + v_line."unitPriceMinor" * v_line.wanted;
  END LOOP;
  INSERT INTO "Claim" ("id", "tenantId", "sellerOrderId", "orderId", "buyerId", "reason", "description",
    "amountMinor", "currency", "idempotencyKey")
  VALUES (v_claim, v_so."tenantId", v_so."id", v_so."orderId", v_buyer, p_reason, btrim(p_description),
    v_total, v_currency, p_key);
  INSERT INTO "ClaimItem" ("id", "claimId", "tenantId", "orderItemId", "quantity", "amountMinor")
  SELECT gen_random_uuid(), v_claim, v_so."tenantId", i."id", (l->>'quantity')::integer,
         i."unitPriceMinor" * (l->>'quantity')::integer
    FROM jsonb_array_elements(p_items) l JOIN "OrderItem" i ON i."id" = (l->>'orderItemId')::uuid;
  PERFORM claim_touch(v_claim, 'OPEN', 'buyer', btrim(p_description), 'claim_opened');
  RETURN QUERY SELECT v_claim, 'created';
END
$$;

CREATE OR REPLACE FUNCTION purge_stale_guest_carts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM "Cart" WHERE "guestTokenHash" IS NOT NULL AND "updatedAt" < now() - interval '30 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;

DROP FUNCTION decide_parameter(uuid, boolean, text);
DROP FUNCTION propose_parameter(text, uuid, text, timestamptz, text, boolean);
DROP FUNCTION parameter_check_value(text, text);
DROP FUNCTION param_interval(text, timestamptz, uuid);
DROP FUNCTION param_value(text, timestamptz, uuid);
DROP TABLE "RegulatoryParameter";
DROP TABLE "ParameterDefinition";
DROP TYPE "ParameterStatus";
