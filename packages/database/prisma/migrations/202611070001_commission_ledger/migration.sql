-- CreateEnum
CREATE TYPE "LedgerAccount" AS ENUM ('PSP_CLEARING', 'SELLER_PAYABLE', 'COMMISSION_DEFERRED', 'COMMISSION_REVENUE', 'REFUND_PAYABLE');

-- AlterEnum
ALTER TYPE "PlatformRole" ADD VALUE 'FINANCE';

-- AlterTable
ALTER TABLE "SellerOrder" ADD COLUMN     "commissionBaseMinor" BIGINT,
ADD COLUMN     "commissionBasisPoints" INTEGER,
ADD COLUMN     "commissionMinor" BIGINT,
ADD COLUMN     "commissionRuleId" UUID,
ADD COLUMN     "sellerNetMinor" BIGINT;

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" UUID NOT NULL,
    "storeId" UUID,
    "basisPoints" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "validFrom" TIMESTAMPTZ(3) NOT NULL,
    "validTo" TIMESTAMPTZ(3),
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerJournal" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "description" TEXT NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerJournal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" UUID NOT NULL,
    "journalId" UUID NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "tenantId" UUID,
    "amountMinor" BIGINT NOT NULL,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommissionRule_storeId_validFrom_idx" ON "CommissionRule"("storeId", "validFrom");

-- CreateIndex
CREATE INDEX "LedgerJournal_occurredAt_idx" ON "LedgerJournal"("occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerJournal_kind_sourceId_key" ON "LedgerJournal"("kind", "sourceId");

-- CreateIndex
CREATE INDEX "LedgerEntry_journalId_idx" ON "LedgerEntry"("journalId");

-- CreateIndex
CREATE INDEX "LedgerEntry_account_tenantId_idx" ON "LedgerEntry"("account", "tenantId");

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "LedgerJournal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ---------- Écrit à la main : commissions, journal équilibré, rapprochement ----------
-- Rôle comparé en texte : la valeur FINANCE est ajoutée dans cette même transaction.
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_values_valid" CHECK (
  "basisPoints" BETWEEN 0 AND 10000
  AND char_length("label") BETWEEN 3 AND 120
  AND ("validTo" IS NULL OR "validTo" > "validFrom"));
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_amount_nonzero" CHECK ("amountMinor" <> 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_seller_subaccount"
  CHECK (("account" = 'SELLER_PAYABLE') = ("tenantId" IS NOT NULL));
ALTER TABLE "LedgerJournal" ADD CONSTRAINT "LedgerJournal_currency" CHECK ("currency" ~ '^[A-Z]{3}$');
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_commission_consistent" CHECK (
  "commissionMinor" IS NULL OR (
    "commissionBasisPoints" BETWEEN 0 AND 10000
    AND "commissionMinor" >= 0 AND "commissionMinor" <= "commissionBaseMinor"
    AND "sellerNetMinor" = "itemsTotalMinor" + "deliveryFeeMinor" - "commissionMinor"));

-- RLS : règles lues par la finance et l'admin, écrites par la finance seule ; journal en lecture
-- pour ces mêmes rôles, jamais modifiable par le runtime (pas de droit UPDATE/DELETE).
ALTER TABLE "CommissionRule" ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_read ON "CommissionRule" FOR SELECT
  USING (app_platform_role()::text IN ('FINANCE', 'ADMIN'));
CREATE POLICY finance_insert ON "CommissionRule" FOR INSERT
  WITH CHECK (app_platform_role()::text = 'FINANCE' AND "createdBy" = app_user_id());
CREATE POLICY finance_update ON "CommissionRule" FOR UPDATE
  USING (app_platform_role()::text = 'FINANCE') WITH CHECK (app_platform_role()::text = 'FINANCE');
GRANT SELECT, INSERT ON "CommissionRule" TO duoshop_app;
GRANT UPDATE ("validTo") ON "CommissionRule" TO duoshop_app;
ALTER TABLE "LedgerJournal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_read ON "LedgerJournal" FOR SELECT
  USING (app_platform_role()::text IN ('FINANCE', 'ADMIN'));
ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_read ON "LedgerEntry" FOR SELECT
  USING (app_platform_role()::text IN ('FINANCE', 'ADMIN'));
GRANT SELECT ON "LedgerJournal", "LedgerEntry" TO duoshop_app;
-- Historique de configuration : la finance trace aussi ses changements de règles.
DROP POLICY admin_insert ON "ConfigAudit";
CREATE POLICY config_insert ON "ConfigAudit" FOR INSERT
  WITH CHECK (app_platform_role()::text IN ('ADMIN', 'FINANCE') AND "actorId" = app_user_id());

-- Équilibre vérifié à la validation de la transaction (débits = crédits, au moins 2 lignes).
CREATE FUNCTION assert_journal_balanced() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_sum numeric; v_lines integer;
BEGIN
  SELECT coalesce(sum("amountMinor"), 0), count(*) INTO v_sum, v_lines
    FROM "LedgerEntry" WHERE "journalId" = NEW."journalId";
  IF v_sum <> 0 OR v_lines < 2 THEN
    RAISE EXCEPTION 'unbalanced ledger journal %', NEW."journalId" USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$$;
CREATE CONSTRAINT TRIGGER ledger_journal_balanced AFTER INSERT ON "LedgerEntry"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();

-- Écriture idempotente : une seule par (kind, source). Lignes nulles ignorées.
CREATE FUNCTION post_journal(p_kind text, p_source text, p_currency text, p_description text,
  p_lines jsonb)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_journal uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_lines) l WHERE (l->>'amount')::bigint <> 0) THEN
    RETURN false;
  END IF;
  INSERT INTO "LedgerJournal" ("id", "kind", "sourceId", "currency", "description")
  VALUES (gen_random_uuid(), p_kind, p_source, p_currency, p_description)
  ON CONFLICT ("kind", "sourceId") DO NOTHING
  RETURNING "id" INTO v_journal;
  IF v_journal IS NULL THEN RETURN false; END IF;
  INSERT INTO "LedgerEntry" ("id", "journalId", "account", "tenantId", "amountMinor")
  SELECT gen_random_uuid(), v_journal, (l->>'account')::"LedgerAccount",
         NULLIF(l->>'tenantId', '')::uuid, (l->>'amount')::bigint
    FROM jsonb_array_elements(p_lines) l
   WHERE (l->>'amount')::bigint <> 0;
  RETURN true;
END
$$;

-- Commission figée au paiement puis écriture : fonds chez le PSP = dû vendeur + commission différée.
CREATE FUNCTION book_seller_order_paid(p_seller_order uuid) RETURNS void
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

-- Déclencheur de paiement (B07) complété : comptabilisation avant les jalons de remise.
CREATE OR REPLACE FUNCTION on_seller_order_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_buyer uuid;
BEGIN
  SELECT "buyerId" INTO v_buyer FROM "Order" WHERE "id" = NEW."orderId";
  PERFORM book_seller_order_paid(NEW."id");
  UPDATE "SellerOrder" SET "fulfilmentStatus" = 'TO_PREPARE' WHERE "id" = NEW."id";
  INSERT INTO "HandoverCode" ("sellerOrderId", "buyerId", "code")
  VALUES (NEW."id", v_buyer, new_handover_code()) ON CONFLICT DO NOTHING;
  INSERT INTO "FulfilmentEvent" ("id", "tenantId", "sellerOrderId", "orderId", "status")
  VALUES (gen_random_uuid(), NEW."tenantId", NEW."id", NEW."orderId", 'TO_PREPARE');
  PERFORM notify_fulfilment(NEW."id", 'order_paid');
  RETURN NULL;
END
$$;

-- Remise prouvée : la commission différée devient acquise.
CREATE FUNCTION on_seller_order_delivered() RETURNS trigger
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
CREATE TRIGGER seller_order_delivered AFTER UPDATE OF "fulfilmentStatus" ON "SellerOrder"
  FOR EACH ROW WHEN (OLD."fulfilmentStatus" IS DISTINCT FROM NEW."fulfilmentStatus"
                     AND NEW."fulfilmentStatus" = 'DELIVERED')
  EXECUTE FUNCTION on_seller_order_delivered();

-- Argent reçu qui ne confirme aucune commande (B06 attentionReason) : dû à l'acheteur.
CREATE FUNCTION on_payment_unapplied() RETURNS trigger
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
CREATE TRIGGER payment_unapplied AFTER UPDATE ON "Payment"
  FOR EACH ROW WHEN (NEW."status" = 'SUCCEEDED' AND NEW."attentionReason" IS NOT NULL)
  EXECUTE FUNCTION on_payment_unapplied();

-- Rapprochement (finance et admin) : balance, dettes vendeurs, écarts.
CREATE FUNCTION finance_report(p_from timestamptz, p_to timestamptz) RETURNS jsonb
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

REVOKE ALL ON FUNCTION post_journal(text, text, text, text, jsonb), book_seller_order_paid(uuid),
  on_seller_order_delivered(), on_payment_unapplied(), finance_report(timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION finance_report(timestamptz, timestamptz) TO duoshop_app;

-- Reprise : sous-commandes déjà payées (sans règle : commission 0, signalée) et remises, paiements à rembourser.
DO $$
DECLARE v_id uuid;
BEGIN
  FOR v_id IN SELECT "id" FROM "SellerOrder" WHERE "status" = 'PAID' AND "commissionMinor" IS NULL LOOP
    PERFORM book_seller_order_paid(v_id);
  END LOOP;
END
$$;
DO $$
DECLARE v_so "SellerOrder"%ROWTYPE; v_currency text; v_p "Payment"%ROWTYPE;
BEGIN
  FOR v_so IN SELECT * FROM "SellerOrder" WHERE "fulfilmentStatus" = 'DELIVERED' LOOP
    SELECT "currency" INTO v_currency FROM "Order" WHERE "id" = v_so."orderId";
    PERFORM post_journal('commission_earned', v_so."id"::text, v_currency, 'Reprise : commission acquise',
      jsonb_build_array(
        jsonb_build_object('account', 'COMMISSION_DEFERRED', 'amount', coalesce(v_so."commissionMinor", 0)),
        jsonb_build_object('account', 'COMMISSION_REVENUE', 'amount', -coalesce(v_so."commissionMinor", 0))));
  END LOOP;
  FOR v_p IN SELECT * FROM "Payment" WHERE "status" = 'SUCCEEDED' AND "attentionReason" IS NOT NULL LOOP
    PERFORM post_journal('unapplied_payment', v_p."id"::text, v_p."currency", 'Reprise : paiement à rembourser',
      jsonb_build_array(
        jsonb_build_object('account', 'PSP_CLEARING', 'amount', v_p."amountMinor"),
        jsonb_build_object('account', 'REFUND_PAYABLE', 'amount', -v_p."amountMinor")));
  END LOOP;
END
$$;
