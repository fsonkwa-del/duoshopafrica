-- Lot 0 (ADR 0008) : paramètres réglementaires datés.
-- Une valeur n'est jamais modifiée : une proposition est approuvée par une seconde personne,
-- ce qui clôt la période précédente. Les fonctions métier lisent la valeur en vigueur à la date
-- de l'événement (param_value / param_interval), jamais une constante.
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "ParameterStatus" AS ENUM ('A_VALIDER', 'VALIDE');

CREATE TABLE "ParameterDefinition" (
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ownerRole" "PlatformRole" NOT NULL,
    "storeScoped" BOOLEAN NOT NULL DEFAULT false,
    "minValue" TEXT,
    "maxValue" TEXT,
    "labelFr" TEXT NOT NULL,
    "labelEn" TEXT NOT NULL,

    CONSTRAINT "ParameterDefinition_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "RegulatoryParameter" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "storeId" UUID,
    "value" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),
    "legalBasis" TEXT,
    "validationStatus" "ParameterStatus" NOT NULL DEFAULT 'A_VALIDER',
    "proposedBy" UUID,
    "proposedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedBy" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "rejectedBy" UUID,
    "rejectedAt" TIMESTAMPTZ(3),
    "rejectReason" TEXT,

    CONSTRAINT "RegulatoryParameter_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RegulatoryParameter_key_storeId_effectiveFrom_idx" ON "RegulatoryParameter"("key", "storeId", "effectiveFrom");

ALTER TABLE "RegulatoryParameter" ADD CONSTRAINT "RegulatoryParameter_key_fkey" FOREIGN KEY ("key") REFERENCES "ParameterDefinition"("key") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RegulatoryParameter" ADD CONSTRAINT "RegulatoryParameter_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Écrit à la main : invariants, RLS, fonctions ----------
ALTER TABLE "ParameterDefinition" ADD CONSTRAINT "ParameterDefinition_values_valid" CHECK (
  "key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND char_length("key") <= 80
  AND "kind" IN ('duration', 'rate', 'amount', 'integer', 'text')
  AND char_length("labelFr") BETWEEN 3 AND 160 AND char_length("labelEn") BETWEEN 3 AND 160);
ALTER TABLE "RegulatoryParameter" ADD CONSTRAINT "RegulatoryParameter_values_valid" CHECK (
  jsonb_typeof("value") = 'string'
  AND ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
  AND ("legalBasis" IS NULL OR char_length("legalBasis") <= 500)
  AND NOT ("approvedAt" IS NOT NULL AND "rejectedAt" IS NOT NULL)
  AND ("approvedBy" IS NULL OR "approvedBy" IS DISTINCT FROM "proposedBy")
  AND ("rejectedAt" IS NULL OR char_length("rejectReason") BETWEEN 10 AND 500));
-- Deux périodes approuvées d'une même clé et d'un même périmètre ne se chevauchent jamais.
ALTER TABLE "RegulatoryParameter" ADD CONSTRAINT "RegulatoryParameter_no_overlap"
  EXCLUDE USING gist ("key" WITH =,
    (coalesce("storeId", '00000000-0000-0000-0000-000000000000'::uuid)) WITH =,
    tstzrange("effectiveFrom", "effectiveTo") WITH &&)
  WHERE ("approvedAt" IS NOT NULL);

-- Lecture par le personnel financier et d'administration ; aucune écriture directe du runtime.
ALTER TABLE "ParameterDefinition" ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON "ParameterDefinition" FOR SELECT
  USING (app_platform_role()::text IN ('ADMIN', 'FINANCE'));
ALTER TABLE "RegulatoryParameter" ENABLE ROW LEVEL SECURITY;
CREATE POLICY staff_read ON "RegulatoryParameter" FOR SELECT
  USING (app_platform_role()::text IN ('ADMIN', 'FINANCE'));
GRANT SELECT ON "ParameterDefinition", "RegulatoryParameter" TO duoshop_app;

-- Valeur en vigueur à une date : celle de la boutique si elle existe, sinon celle de la plateforme.
CREATE FUNCTION param_value(p_key text, p_at timestamptz DEFAULT now(), p_store uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_value text;
BEGIN
  SELECT p."value" #>> '{}' INTO v_value FROM "RegulatoryParameter" p
   WHERE p."key" = p_key AND p."approvedAt" IS NOT NULL
     AND (p."storeId" IS NULL OR p."storeId" = p_store)
     AND p."effectiveFrom" <= p_at AND (p."effectiveTo" IS NULL OR p."effectiveTo" > p_at)
   ORDER BY p."storeId" NULLS LAST
   LIMIT 1;
  IF v_value IS NULL THEN
    RAISE EXCEPTION 'parameter_missing: %', p_key USING ERRCODE = 'P0002';
  END IF;
  RETURN v_value;
END
$$;
CREATE FUNCTION param_interval(p_key text, p_at timestamptz DEFAULT now(), p_store uuid DEFAULT NULL)
RETURNS interval
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
  $$ SELECT param_value(p_key, p_at, p_store)::interval $$;

-- Contrôle d'une valeur selon le type et les bornes de sa définition.
CREATE FUNCTION parameter_check_value(p_key text, p_value text)
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d "ParameterDefinition"%ROWTYPE;
  v_interval interval;
  v_number numeric;
BEGIN
  SELECT * INTO d FROM "ParameterDefinition" WHERE "key" = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'parameter_unknown' USING ERRCODE = 'P0002'; END IF;
  IF p_value IS NULL OR char_length(p_value) NOT BETWEEN 1 AND 2000 THEN
    RAISE EXCEPTION 'parameter_invalid' USING ERRCODE = '22023';
  END IF;
  BEGIN
    IF d."kind" = 'duration' THEN
      v_interval := p_value::interval;
      IF v_interval <= interval '0'
         OR (d."minValue" IS NOT NULL AND v_interval < d."minValue"::interval)
         OR (d."maxValue" IS NOT NULL AND v_interval > d."maxValue"::interval) THEN
        RAISE EXCEPTION 'out of range';
      END IF;
    ELSIF d."kind" IN ('rate', 'amount', 'integer') THEN
      IF (d."kind" = 'rate' AND p_value !~ '^[0-9]+(\.[0-9]{1,6})?$')
         OR (d."kind" <> 'rate' AND p_value !~ '^-?[0-9]{1,18}$') THEN
        RAISE EXCEPTION 'bad number';
      END IF;
      v_number := p_value::numeric;
      IF (d."kind" = 'rate' AND v_number > 1)
         OR (d."kind" = 'amount' AND v_number < 0)
         OR (d."minValue" IS NOT NULL AND v_number < d."minValue"::numeric)
         OR (d."maxValue" IS NOT NULL AND v_number > d."maxValue"::numeric) THEN
        RAISE EXCEPTION 'out of range';
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'parameter_invalid' USING ERRCODE = '22023';
  END;
END
$$;

-- Proposition : par le rôle propriétaire de la clé, jamais rétroactive (tolérance d'horloge).
CREATE FUNCTION propose_parameter(p_key text, p_store uuid, p_value text, p_from timestamptz,
  p_legal_basis text, p_validated boolean)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  d "ParameterDefinition"%ROWTYPE;
  v_id uuid := gen_random_uuid();
  v_basis text := nullif(trim(coalesce(p_legal_basis, '')), '');
BEGIN
  SELECT * INTO d FROM "ParameterDefinition" WHERE "key" = p_key;
  IF NOT FOUND THEN RAISE EXCEPTION 'parameter_unknown' USING ERRCODE = 'P0002'; END IF;
  IF app_user_id() IS NULL OR app_platform_role() IS NULL
     OR app_platform_role()::text <> d."ownerRole"::text THEN
    RAISE EXCEPTION 'parameter_forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_store IS NOT NULL AND NOT d."storeScoped" THEN
    RAISE EXCEPTION 'parameter_scope' USING ERRCODE = '22023';
  END IF;
  IF p_store IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Store" WHERE "id" = p_store) THEN
    RAISE EXCEPTION 'parameter_store_unknown' USING ERRCODE = 'P0002';
  END IF;
  PERFORM parameter_check_value(p_key, p_value);
  IF p_from IS NULL OR p_from < now() - interval '5 minutes' THEN
    RAISE EXCEPTION 'parameter_retroactive' USING ERRCODE = '22023';
  END IF;
  -- « Validé » exige la référence de l'avis (juriste, expert-comptable, prestataire).
  IF p_validated AND (v_basis IS NULL OR char_length(v_basis) < 10) THEN
    RAISE EXCEPTION 'parameter_basis_required' USING ERRCODE = '22023';
  END IF;
  INSERT INTO "RegulatoryParameter" ("id", "key", "storeId", "value", "effectiveFrom",
    "legalBasis", "validationStatus", "proposedBy")
  VALUES (v_id, p_key, p_store, to_jsonb(p_value), p_from, v_basis,
    CASE WHEN p_validated THEN 'VALIDE' ELSE 'A_VALIDER' END::"ParameterStatus", app_user_id());
  INSERT INTO "ConfigAudit" ("id", "actorId", "entity", "entityId", "action", "after")
  VALUES (gen_random_uuid(), app_user_id(), 'RegulatoryParameter', v_id, 'propose',
    jsonb_build_object('key', p_key, 'storeId', p_store, 'value', p_value,
      'effectiveFrom', p_from, 'legalBasis', v_basis, 'validated', p_validated));
  RETURN v_id;
END
$$;

-- Décision : une seconde personne (ADMIN ou FINANCE). L'approbation clôt la période en cours.
CREATE FUNCTION decide_parameter(p_id uuid, p_approve boolean, p_reason text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  r "RegulatoryParameter"%ROWTYPE;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_closed integer;
BEGIN
  IF app_user_id() IS NULL OR app_platform_role() IS NULL
     OR app_platform_role()::text NOT IN ('ADMIN', 'FINANCE') THEN
    RAISE EXCEPTION 'parameter_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO r FROM "RegulatoryParameter" WHERE "id" = p_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF r."approvedAt" IS NOT NULL OR r."rejectedAt" IS NOT NULL THEN RETURN 'already_decided'; END IF;
  IF r."proposedBy" = app_user_id() THEN RETURN 'same_person'; END IF;
  -- Une décision à la fois par clé : les périodes se calculent sans course.
  PERFORM 1 FROM "ParameterDefinition" WHERE "key" = r."key" FOR UPDATE;
  IF NOT p_approve THEN
    IF v_reason IS NULL OR char_length(v_reason) < 10 THEN RETURN 'reason_required'; END IF;
    UPDATE "RegulatoryParameter"
       SET "rejectedBy" = app_user_id(), "rejectedAt" = now(), "rejectReason" = v_reason
     WHERE "id" = p_id;
  ELSE
    IF r."effectiveFrom" < now() - interval '5 minutes' THEN RETURN 'retroactive'; END IF;
    IF EXISTS (SELECT 1 FROM "RegulatoryParameter" p
                WHERE p."key" = r."key" AND p."storeId" IS NOT DISTINCT FROM r."storeId"
                  AND p."approvedAt" IS NOT NULL AND p."effectiveFrom" >= r."effectiveFrom") THEN
      RETURN 'conflict';
    END IF;
    UPDATE "RegulatoryParameter" p SET "effectiveTo" = r."effectiveFrom"
     WHERE p."key" = r."key" AND p."storeId" IS NOT DISTINCT FROM r."storeId"
       AND p."approvedAt" IS NOT NULL AND p."effectiveFrom" < r."effectiveFrom"
       AND (p."effectiveTo" IS NULL OR p."effectiveTo" > r."effectiveFrom");
    GET DIAGNOSTICS v_closed = ROW_COUNT;
    UPDATE "RegulatoryParameter" SET "approvedBy" = app_user_id(), "approvedAt" = now()
     WHERE "id" = p_id;
  END IF;
  INSERT INTO "ConfigAudit" ("id", "actorId", "entity", "entityId", "action", "after")
  VALUES (gen_random_uuid(), app_user_id(), 'RegulatoryParameter', p_id,
    CASE WHEN p_approve THEN 'approve' ELSE 'reject' END,
    jsonb_build_object('key', r."key", 'storeId', r."storeId", 'reason', v_reason));
  RETURN CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END;
END
$$;

REVOKE ALL ON FUNCTION param_value(text, timestamptz, uuid), param_interval(text, timestamptz, uuid),
  parameter_check_value(text, text),
  propose_parameter(text, uuid, text, timestamptz, text, boolean),
  decide_parameter(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION param_value(text, timestamptz, uuid), param_interval(text, timestamptz, uuid),
  propose_parameter(text, uuid, text, timestamptz, text, boolean),
  decide_parameter(uuid, boolean, text) TO duoshop_app;

-- Valeurs d'origine, toutes « à valider » : elles reprennent les constantes remplacées ci-dessous.
INSERT INTO "ParameterDefinition" ("key", "kind", "ownerRole", "minValue", "maxValue", "labelFr", "labelEn") VALUES
  ('order.payment_window', 'duration', 'ADMIN', '5 minutes', '24 hours',
   'Délai pour payer une commande (stock réservé)', 'Time to pay an order (stock held)'),
  ('payment.attempt_window', 'duration', 'ADMIN', '2 minutes', '2 hours',
   'Durée d''une tentative de paiement sans réponse', 'Unanswered payment attempt lifetime'),
  ('claims.window', 'duration', 'ADMIN', '1 day', '365 days',
   'Délai de réclamation après la remise', 'Claim window after handover'),
  ('guest_cart.retention', 'duration', 'ADMIN', '1 day', '365 days',
   'Conservation des paniers visiteurs inactifs', 'Inactive guest cart retention');
INSERT INTO "RegulatoryParameter" ("id", "key", "value", "effectiveFrom", "legalBasis", "approvedAt") VALUES
  (gen_random_uuid(), 'order.payment_window', '"30 minutes"', '2026-01-01T00:00:00Z',
   'Valeur d''origine (B05). Hypothèse non validée.', now()),
  (gen_random_uuid(), 'payment.attempt_window', '"10 minutes"', '2026-01-01T00:00:00Z',
   'Valeur d''origine (B06). Hypothèse non validée.', now()),
  (gen_random_uuid(), 'claims.window', '"7 days"', '2026-01-01T00:00:00Z',
   'Valeur d''origine (B09), hypothèse H23. À valider par juriste.', now()),
  (gen_random_uuid(), 'guest_cart.retention', '"30 days"', '2026-01-01T00:00:00Z',
   'Valeur d''origine (B04 bis), hypothèse H9. À valider par juriste.', now());

-- ---------- Constantes remplacées par les paramètres (corps inchangés par ailleurs) ----------
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

CREATE OR REPLACE FUNCTION close_unpaid_order(p_order uuid, p_status "OrderStatus")
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status = 'CANCELLED' THEN
    UPDATE "Order" SET "status" = 'CANCELLED', "closedAt" = now()
     WHERE "id" = p_order AND "status" = 'AWAITING_PAYMENT' AND "buyerId" = app_user_id()
       AND NOT EXISTS (SELECT 1 FROM "Payment" p WHERE p."orderId" = p_order
                         AND p."status" = 'PENDING' AND p."createdAt" >= now() - param_interval('payment.attempt_window'));
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
  IF v_so."fulfilmentStatus" <> 'DELIVERED' OR v_so."deliveredAt" < now() - param_interval('claims.window', coalesce(v_so."deliveredAt", now())) THEN
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
  DELETE FROM "Cart" WHERE "guestTokenHash" IS NOT NULL AND "updatedAt" < now() - param_interval('guest_cart.retention');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
