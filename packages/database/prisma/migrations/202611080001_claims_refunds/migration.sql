-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'ESCALATED', 'REFUND_APPROVED', 'CLOSED_NO_REFUND', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ClaimReason" AS ENUM ('DAMAGED', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'MISSING_ITEM', 'OTHER');

-- CreateEnum
CREATE TYPE "RefundStatus" AS ENUM ('PENDING_PROVIDER', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "Claim" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "reason" "ClaimReason" NOT NULL,
    "description" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'OPEN',
    "amountMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Claim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimItem" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amountMinor" BIGINT NOT NULL,

    CONSTRAINT "ClaimItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClaimEvent" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "status" "ClaimStatus" NOT NULL,
    "actor" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClaimEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "paymentId" UUID,
    "amountMinor" BIGINT NOT NULL,
    "commissionReversedMinor" BIGINT NOT NULL,
    "sellerDebitMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "RefundStatus" NOT NULL DEFAULT 'PENDING_PROVIDER',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Claim_sellerOrderId_idx" ON "Claim"("sellerOrderId");

-- CreateIndex
CREATE INDEX "Claim_tenantId_status_idx" ON "Claim"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Claim_status_createdAt_idx" ON "Claim"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Claim_buyerId_idempotencyKey_key" ON "Claim"("buyerId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ClaimItem_claimId_orderItemId_key" ON "ClaimItem"("claimId", "orderItemId");

-- CreateIndex
CREATE INDEX "ClaimEvent_claimId_createdAt_idx" ON "ClaimEvent"("claimId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_claimId_key" ON "Refund"("claimId");

-- CreateIndex
CREATE INDEX "Refund_status_createdAt_idx" ON "Refund"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Refund_tenantId_idx" ON "Refund"("tenantId");

-- AddForeignKey
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_tenantId_sellerOrderId_fkey" FOREIGN KEY ("tenantId", "sellerOrderId") REFERENCES "SellerOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClaimEvent" ADD CONSTRAINT "ClaimEvent_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "Claim"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------- Écrit à la main : invariants, RLS, transitions, remboursement ----------
ALTER TABLE "Claim" ADD CONSTRAINT "Claim_values_valid" CHECK (
  "amountMinor" > 0 AND char_length("description") BETWEEN 10 AND 1000
  AND char_length("idempotencyKey") BETWEEN 16 AND 64);
ALTER TABLE "ClaimItem" ADD CONSTRAINT "ClaimItem_values_valid" CHECK ("quantity" BETWEEN 1 AND 99 AND "amountMinor" > 0);
ALTER TABLE "ClaimEvent" ADD CONSTRAINT "ClaimEvent_note_length" CHECK (char_length(coalesce("note", '')) <= 1000);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amounts_consistent" CHECK (
  "amountMinor" > 0 AND "commissionReversedMinor" >= 0
  AND "sellerDebitMinor" = "amountMinor" - "commissionReversedMinor");

-- Acheteur : ses réclamations ; vendeur : celles de son tenant ; personnel : lecture.
ALTER TABLE "Claim" ENABLE ROW LEVEL SECURITY;
CREATE POLICY buyer_scope ON "Claim" FOR SELECT USING ("buyerId" = app_user_id());
CREATE POLICY tenant_scope ON "Claim" FOR SELECT USING ("tenantId" = app_tenant_id());
CREATE POLICY staff_read ON "Claim" FOR SELECT USING (app_platform_role() IS NOT NULL);
ALTER TABLE "ClaimItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY claim_scope ON "ClaimItem" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Claim" c WHERE c."id" = "claimId"));
ALTER TABLE "ClaimEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY claim_scope ON "ClaimEvent" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Claim" c WHERE c."id" = "claimId"));
ALTER TABLE "Refund" ENABLE ROW LEVEL SECURITY;
CREATE POLICY buyer_scope ON "Refund" FOR SELECT USING ("buyerId" = app_user_id());
CREATE POLICY tenant_scope ON "Refund" FOR SELECT USING ("tenantId" = app_tenant_id());
CREATE POLICY staff_read ON "Refund" FOR SELECT USING (app_platform_role() IS NOT NULL);
GRANT SELECT ON "Claim", "ClaimItem", "ClaimEvent", "Refund" TO duoshop_app;

-- Historique et notifications (acheteur, et propriétaire/gérants de la boutique).
CREATE FUNCTION claim_touch(p_claim uuid, p_status "ClaimStatus", p_actor text, p_note text, p_kind text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c "Claim"%ROWTYPE; v_store uuid; v_name text;
BEGIN
  SELECT * INTO v_c FROM "Claim" WHERE "id" = p_claim;
  SELECT so."storeId", so."storeName" INTO v_store, v_name FROM "SellerOrder" so WHERE so."id" = v_c."sellerOrderId";
  INSERT INTO "ClaimEvent" ("id", "claimId", "status", "actor", "note")
  VALUES (gen_random_uuid(), p_claim, p_status, p_actor, NULLIF(btrim(coalesce(p_note, '')), ''));
  IF p_actor <> 'buyer' THEN
    INSERT INTO "Notification" ("id", "userId", "kind", "orderId", "data")
    VALUES (gen_random_uuid(), v_c."buyerId", p_kind, v_c."orderId",
            jsonb_build_object('storeName', v_name, 'status', p_status));
  END IF;
  IF p_actor <> 'seller' THEN
    INSERT INTO "Notification" ("id", "userId", "kind", "orderId", "data")
    SELECT gen_random_uuid(), m."userId", 'seller_' || p_kind, NULL,
           jsonb_build_object('storeId', v_store, 'storeName', v_name, 'status', p_status,
                              'reference', upper(left(v_c."orderId"::text, 8)))
      FROM "StoreMember" m
     WHERE m."storeId" = v_store AND m."active" AND m."role" IN ('OWNER', 'MANAGER');
  END IF;
  INSERT INTO "OutboxEvent" ("id", "tenantId", "kind", "aggregateId", "payload")
  VALUES (gen_random_uuid(), v_c."tenantId", 'claim.' || p_kind, p_claim::text,
          jsonb_build_object('status', p_status, 'orderId', v_c."orderId"));
END
$$;

-- Remboursement décidé : jamais au-delà de l'encaissé ; commission reprise au même taux
-- (half-up), plafonnée à ce qui reste ; écriture : dû vendeur ↓, commission ↓, dette acheteur ↑.
CREATE FUNCTION decide_refund(p_claim uuid) RETURNS void
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

-- Ouverture par l'acheteur : remise prouvée depuis 7 jours au plus, une réclamation active à la
-- fois, quantités bornées par ce qui n'a pas déjà été remboursé. Même clé => rejeu.
CREATE FUNCTION open_claim(p_seller_order uuid, p_reason "ClaimReason", p_description text,
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

-- Réponse du vendeur (contexte tenant) : accepter = remboursement ; refuser exige un motif.
CREATE FUNCTION respond_claim(p_claim uuid, p_accept boolean, p_note text, p_version integer)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c "Claim"%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM "Claim" WHERE "id" = p_claim AND "tenantId" = app_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_c."status" <> 'OPEN' THEN RETURN 'invalid_transition'; END IF;
  IF v_c."version" <> p_version THEN RETURN 'stale_version'; END IF;
  IF NOT p_accept AND char_length(btrim(coalesce(p_note, ''))) < 10 THEN RETURN 'note_required'; END IF;
  UPDATE "Claim" SET "status" = CASE WHEN p_accept THEN 'ACCEPTED'::"ClaimStatus" ELSE 'REJECTED' END,
         "version" = "version" + 1, "closedAt" = CASE WHEN p_accept THEN now() END
   WHERE "id" = p_claim;
  PERFORM claim_touch(p_claim, CASE WHEN p_accept THEN 'ACCEPTED'::"ClaimStatus" ELSE 'REJECTED' END,
                      'seller', p_note, CASE WHEN p_accept THEN 'claim_accepted' ELSE 'claim_rejected' END);
  IF p_accept THEN PERFORM decide_refund(p_claim); END IF;
  RETURN 'ok';
END
$$;

-- Acheteur : demander l'arbitrage après un refus, ou retirer sa réclamation.
CREATE FUNCTION buyer_claim_action(p_claim uuid, p_to "ClaimStatus")
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c "Claim"%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM "Claim" WHERE "id" = p_claim AND "buyerId" = app_user_id() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF NOT ((p_to = 'ESCALATED' AND v_c."status" = 'REJECTED')
       OR (p_to = 'WITHDRAWN' AND v_c."status" IN ('OPEN', 'REJECTED', 'ESCALATED'))) THEN
    RETURN 'invalid_transition';
  END IF;
  UPDATE "Claim" SET "status" = p_to, "version" = "version" + 1,
         "closedAt" = CASE WHEN p_to = 'WITHDRAWN' THEN now() END
   WHERE "id" = p_claim;
  PERFORM claim_touch(p_claim, p_to, 'buyer', NULL,
                      CASE WHEN p_to = 'ESCALATED' THEN 'claim_escalated' ELSE 'claim_withdrawn' END);
  RETURN 'ok';
END
$$;

-- Arbitrage par un ADMIN plateforme (le support instruit, ne décide pas).
CREATE FUNCTION arbitrate_claim(p_claim uuid, p_refund boolean, p_note text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_c "Claim"%ROWTYPE; v_to "ClaimStatus";
BEGIN
  IF app_platform_role()::text IS DISTINCT FROM 'ADMIN' THEN RETURN 'forbidden'; END IF;
  SELECT * INTO v_c FROM "Claim" WHERE "id" = p_claim FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_c."status" <> 'ESCALATED' THEN RETURN 'invalid_transition'; END IF;
  IF char_length(btrim(coalesce(p_note, ''))) < 10 THEN RETURN 'note_required'; END IF;
  v_to := CASE WHEN p_refund THEN 'REFUND_APPROVED'::"ClaimStatus" ELSE 'CLOSED_NO_REFUND' END;
  UPDATE "Claim" SET "status" = v_to, "version" = "version" + 1, "closedAt" = now() WHERE "id" = p_claim;
  PERFORM claim_touch(p_claim, v_to, 'platform', p_note, 'claim_arbitrated');
  IF p_refund THEN PERFORM decide_refund(p_claim); END IF;
  RETURN 'ok';
END
$$;

-- Dû vendeur gelé par les réclamations en cours (net de la vente moins remboursements décidés).
CREATE FUNCTION finance_holds() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_platform_role()::text IS DISTINCT FROM 'FINANCE' AND app_platform_role()::text IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'finance report restricted' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((
    SELECT jsonb_agg(jsonb_build_object('tenantId', h."tenantId", 'currency', h.currency,
                                        'amount', h.amount::text, 'stores', h.stores))
      FROM (
        SELECT so."tenantId", c."currency" AS currency,
               sum(coalesce(so."sellerNetMinor", 0)
                   - coalesce((SELECT sum(r."sellerDebitMinor") FROM "Refund" r JOIN "Claim" rc ON rc."id" = r."claimId"
                                WHERE rc."sellerOrderId" = so."id"), 0)) AS amount,
               (SELECT string_agg(s."name", ', ') FROM "Store" s WHERE s."tenantId" = so."tenantId") AS stores
          FROM "SellerOrder" so
          JOIN "Claim" c ON c."sellerOrderId" = so."id" AND c."status" IN ('OPEN', 'REJECTED', 'ESCALATED')
         GROUP BY so."tenantId", c."currency") h), '[]'::jsonb);
END
$$;

REVOKE ALL ON FUNCTION claim_touch(uuid, "ClaimStatus", text, text, text), decide_refund(uuid),
  open_claim(uuid, "ClaimReason", text, jsonb, text), respond_claim(uuid, boolean, text, integer),
  buyer_claim_action(uuid, "ClaimStatus"), arbitrate_claim(uuid, boolean, text), finance_holds() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_claim(uuid, "ClaimReason", text, jsonb, text),
  respond_claim(uuid, boolean, text, integer), buyer_claim_action(uuid, "ClaimStatus"),
  arbitrate_claim(uuid, boolean, text), finance_holds() TO duoshop_app;
