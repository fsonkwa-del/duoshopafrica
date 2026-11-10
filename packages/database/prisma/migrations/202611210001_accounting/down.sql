-- Retour arrière du lot 4 : refusé dès qu'une facture, une correspondance de compte, une écriture
-- de frais, de TVA ou une constatation au taux du lot 4 existe.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "CommissionInvoice") OR EXISTS (SELECT 1 FROM "LedgerAccountMapping")
     OR EXISTS (SELECT 1 FROM "LedgerJournal" WHERE "kind" = 'psp_fee')
     OR EXISTS (SELECT 1 FROM "LedgerEntry" WHERE "account"::text = 'VAT_COLLECTED')
     OR EXISTS (SELECT 1 FROM "SellerOrder" WHERE "commissionRecognition" = 'CLAIM_WINDOW_END')
     OR EXISTS (SELECT 1 FROM "RegulatoryParameter" WHERE "proposedBy" IS NOT NULL
                  AND "key" IN ('vat.commission_rate', 'psp.fee_rate.fapshi', 'fees.borne_by',
                    'commission.recognition', 'commission.invoice_due', 'platform.legal_name',
                    'platform.niu', 'platform.address')) THEN
    RAISE EXCEPTION 'down refused: accounting records of lot 4 exist';
  END IF;
END
$$;
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

CREATE OR REPLACE FUNCTION finance_report(p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_result jsonb;
BEGIN
  IF app_platform_role()::text IS DISTINCT FROM 'FINANCE' AND app_platform_role()::text IS DISTINCT FROM 'ADMIN' THEN
    RAISE EXCEPTION 'finance report restricted' USING ERRCODE = '42501';
  END IF;
  WITH balances AS (
    SELECT e."account"::text AS account, j."currency", sum(e."amountMinor")::text AS amount
      FROM "LedgerEntry" e JOIN "LedgerJournal" j ON j."id" = e."journalId"
     GROUP BY 1, 2 ORDER BY 1, 2
  ), payables AS (
    SELECT e."tenantId", j."currency", (-sum(e."amountMinor"))::text AS amount,
           (SELECT string_agg(s."name", ', ') FROM "Store" s WHERE s."tenantId" = e."tenantId") AS stores
      FROM "LedgerEntry" e JOIN "LedgerJournal" j ON j."id" = e."journalId"
     WHERE e."account" = 'SELLER_PAYABLE'
     GROUP BY e."tenantId", j."currency"
  ), payment_posted AS (
    SELECT p."id", p."orderId", p."amountMinor", p."attentionReason",
      CASE WHEN p."attentionReason" IS NOT NULL THEN
        (SELECT coalesce(sum(e."amountMinor"), 0) FROM "LedgerJournal" j JOIN "LedgerEntry" e ON e."journalId" = j."id"
          WHERE j."kind" = 'unapplied_payment' AND j."sourceId" = p."id"::text AND e."account" = 'PSP_CLEARING')
      ELSE
        (SELECT coalesce(sum(e."amountMinor"), 0) FROM "SellerOrder" so
           JOIN "LedgerJournal" j ON j."kind" = 'order_paid' AND j."sourceId" = so."id"::text
           JOIN "LedgerEntry" e ON e."journalId" = j."id" AND e."account" = 'PSP_CLEARING'
          WHERE so."orderId" = p."orderId")
      END AS posted
      FROM "Payment" p
     WHERE p."status" = 'SUCCEEDED' AND p."settledAt" >= p_from AND p."settledAt" < p_to
  ), daily AS (
    SELECT d.day,
           coalesce((SELECT sum(p."amountMinor") FROM "Payment" p WHERE p."status" = 'SUCCEEDED'
                      AND (p."settledAt" AT TIME ZONE 'Africa/Douala')::date = d.day), 0) AS settled,
           coalesce((SELECT sum(e."amountMinor") FROM "LedgerJournal" j JOIN "LedgerEntry" e ON e."journalId" = j."id"
                      WHERE e."account" = 'PSP_CLEARING'
                        AND (j."occurredAt" AT TIME ZONE 'Africa/Douala')::date = d.day), 0) AS posted
      FROM (SELECT generate_series((p_from AT TIME ZONE 'Africa/Douala')::date,
                                   ((p_to - interval '1 microsecond') AT TIME ZONE 'Africa/Douala')::date,
                                   interval '1 day')::date AS day) d
  ), anomalies AS (
    SELECT 'payment_not_journaled' AS kind, id::text AS reference,
           "amountMinor"::text AS expected, posted::text AS posted
      FROM payment_posted WHERE posted <> "amountMinor"
    UNION ALL
    SELECT 'no_commission_rule', so."id"::text, NULL, NULL
      FROM "SellerOrder" so
     WHERE so."status" = 'PAID' AND so."commissionRuleId" IS NULL AND so."createdAt" >= p_from AND so."createdAt" < p_to
    UNION ALL
    SELECT 'daily_mismatch', day::text, settled::text, posted::text FROM daily WHERE settled <> posted
    UNION ALL
    SELECT 'unbalanced_journal', j."id"::text, '0', sum(e."amountMinor")::text
      FROM "LedgerJournal" j JOIN "LedgerEntry" e ON e."journalId" = j."id"
     GROUP BY j."id" HAVING sum(e."amountMinor") <> 0
  )
  SELECT jsonb_build_object(
    'balances', coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM balances b), '[]'::jsonb),
    'payables', coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM payables p), '[]'::jsonb),
    'anomalies', coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM anomalies a), '[]'::jsonb),
    'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('day', day, 'settled', settled::text, 'posted', posted::text) ORDER BY day) FROM daily), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END
$$;

CREATE OR REPLACE FUNCTION on_seller_order_delivered() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_currency text;
BEGIN
  SELECT "currency" INTO v_currency FROM "Order" WHERE "id" = NEW."orderId";
  PERFORM post_journal('commission_earned', NEW."id"::text, v_currency,
    'Commission acquise à la remise — ' || NEW."storeName" || ' — ' || upper(left(NEW."orderId"::text, 8)),
    jsonb_build_array(
      jsonb_build_object('account', 'COMMISSION_DEFERRED', 'amount', coalesce(NEW."commissionMinor", 0)),
      jsonb_build_object('account', 'COMMISSION_REVENUE', 'amount', -coalesce(NEW."commissionMinor", 0))));
  RETURN NULL;
END
$$;

DROP FUNCTION mark_invoice_paid(uuid, text);
DROP FUNCTION issue_commission_invoices(date, date);
DROP FUNCTION next_invoice_number(text, integer);
DROP FUNCTION book_psp_fee(text, text, text, bigint, uuid, uuid, text);
DROP FUNCTION recognize_due_commissions();
DROP FUNCTION recognize_commission(uuid);
DROP FUNCTION vat_included(bigint, numeric);
DROP FUNCTION round_half_up(bigint, numeric);
DROP FUNCTION param_value_or_null(text, timestamptz, uuid);
DROP TABLE "CommissionInvoiceLine";
DROP TABLE "CommissionInvoice";
DROP TABLE "InvoiceCounter";
DROP TABLE "LedgerAccountMapping";
ALTER TABLE "Refund" DROP CONSTRAINT "Refund_reversal_valid";
ALTER TABLE "Refund" DROP COLUMN "commissionVatReversedMinor", DROP COLUMN "reversedFrom";
ALTER TABLE "SellerOrder" DROP CONSTRAINT "SellerOrder_recognition_valid";
ALTER TABLE "SellerOrder" DROP COLUMN "commissionRecognition", DROP COLUMN "commissionRecognizedMinor",
  DROP COLUMN "commissionVatMinor";
DELETE FROM "RegulatoryParameter" WHERE "key" IN ('vat.commission_rate', 'psp.fee_rate.fapshi',
  'fees.borne_by', 'commission.recognition', 'commission.invoice_due', 'platform.legal_name',
  'platform.niu', 'platform.address');
DELETE FROM "ParameterDefinition" WHERE "key" IN ('vat.commission_rate', 'psp.fee_rate.fapshi',
  'fees.borne_by', 'commission.recognition', 'commission.invoice_due', 'platform.legal_name',
  'platform.niu', 'platform.address');
DROP TYPE "InvoiceKind";
