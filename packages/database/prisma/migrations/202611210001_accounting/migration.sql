-- Lot 4 (ADR 0012) : correspondance SYSCOHADA, frais du prestataire, TVA sur commission,
-- constatation paramétrable de la commission, factures et avoirs numérotés sans trou.
-- Taux, comptes et règles fiscales : À VALIDER PAR EXPERT-COMPTABLE (H12 à H16, H24).
-- Hypothèse H13 bis : le taux de commission s'entend TVA comprise ; la TVA est extraite de la
-- commission, ce qui ne change ni le net vendeur ni les contrôles existants.
CREATE TYPE "InvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

ALTER TABLE "SellerOrder" ADD COLUMN "commissionRecognition" TEXT,
ADD COLUMN "commissionRecognizedMinor" BIGINT,
ADD COLUMN "commissionVatMinor" BIGINT;

ALTER TABLE "Refund" ADD COLUMN "commissionVatReversedMinor" BIGINT,
ADD COLUMN "reversedFrom" TEXT;

CREATE TABLE "LedgerAccountMapping" (
    "id" UUID NOT NULL,
    "account" "LedgerAccount" NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "validationStatus" "ParameterStatus" NOT NULL DEFAULT 'A_VALIDER',
    "createdBy" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerAccountMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InvoiceCounter" (
    "series" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("series", "fiscalYear")
);

CREATE TABLE "CommissionInvoice" (
    "id" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "series" TEXT NOT NULL,
    "fiscalYear" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "tenantId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "periodStart" DATE NOT NULL,
    "periodEnd" DATE NOT NULL,
    "totalTtcMinor" BIGINT NOT NULL,
    "vatMinor" BIGINT NOT NULL,
    "totalHtMinor" BIGINT NOT NULL,
    "vatRate" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "seller" JSONB NOT NULL,
    "platform" JSONB NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMPTZ(3) NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "paidReference" TEXT,

    CONSTRAINT "CommissionInvoice_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommissionInvoiceLine" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "kind" "InvoiceKind" NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "refundId" UUID,
    "orderReference" TEXT NOT NULL,
    "totalTtcMinor" BIGINT NOT NULL,
    "vatMinor" BIGINT NOT NULL,

    CONSTRAINT "CommissionInvoiceLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LedgerAccountMapping_account_effectiveFrom_key" ON "LedgerAccountMapping"("account", "effectiveFrom");

CREATE UNIQUE INDEX "CommissionInvoice_series_fiscalYear_number_key" ON "CommissionInvoice"("series", "fiscalYear", "number");

CREATE INDEX "CommissionInvoice_storeId_issuedAt_idx" ON "CommissionInvoice"("storeId", "issuedAt");

CREATE INDEX "CommissionInvoiceLine_invoiceId_idx" ON "CommissionInvoiceLine"("invoiceId");

ALTER TABLE "CommissionInvoice" ADD CONSTRAINT "CommissionInvoice_tenantId_storeId_fkey" FOREIGN KEY ("tenantId", "storeId") REFERENCES "Store"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommissionInvoiceLine" ADD CONSTRAINT "CommissionInvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "CommissionInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------- Écrit à la main : invariants ----------
-- Une sous-commande n'est facturée qu'une fois ; un remboursement n'est crédité qu'une fois.
CREATE UNIQUE INDEX "CommissionInvoiceLine_invoice_once" ON "CommissionInvoiceLine"("sellerOrderId")
  WHERE "kind" = 'INVOICE';
CREATE UNIQUE INDEX "CommissionInvoiceLine_credit_once" ON "CommissionInvoiceLine"("refundId")
  WHERE "kind" = 'CREDIT_NOTE';
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_recognition_valid" CHECK (
  ("commissionRecognition" IS NULL OR "commissionRecognition" IN ('HANDOVER', 'CLAIM_WINDOW_END'))
  AND ("commissionVatMinor" IS NULL OR ("commissionVatMinor" >= 0
       AND "commissionVatMinor" <= coalesce("commissionRecognizedMinor", 0))));
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_reversal_valid" CHECK (
  ("reversedFrom" IS NULL OR "reversedFrom" IN ('REVENUE', 'DEFERRED'))
  AND ("commissionVatReversedMinor" IS NULL OR "commissionVatReversedMinor" BETWEEN 0 AND "commissionReversedMinor"));
ALTER TABLE "LedgerAccountMapping" ADD CONSTRAINT "LedgerAccountMapping_values_valid" CHECK (
  "accountNumber" ~ '^[0-9]{2,12}$' AND char_length("label") BETWEEN 2 AND 160);
ALTER TABLE "InvoiceCounter" ADD CONSTRAINT "InvoiceCounter_values_valid" CHECK (
  "series" ~ '^[A-Z]{2,6}$' AND "fiscalYear" BETWEEN 2000 AND 2999 AND "next" >= 1);
ALTER TABLE "CommissionInvoice" ADD CONSTRAINT "CommissionInvoice_values_valid" CHECK (
  "number" >= 1 AND "totalTtcMinor" >= 0 AND "vatMinor" >= 0
  AND "totalHtMinor" = "totalTtcMinor" - "vatMinor" AND "periodEnd" >= "periodStart"
  AND (("paidAt" IS NULL) = ("paidReference" IS NULL)));

-- ---------- RLS ----------
ALTER TABLE "LedgerAccountMapping" ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_read ON "LedgerAccountMapping" FOR SELECT
  USING (app_platform_role()::text IN ('FINANCE', 'ADMIN'));
CREATE POLICY finance_insert ON "LedgerAccountMapping" FOR INSERT
  WITH CHECK (app_platform_role()::text = 'FINANCE' AND "createdBy" = app_user_id());
GRANT SELECT, INSERT ON "LedgerAccountMapping" TO duoshop_app;

-- Factures : la finance et l'admin lisent tout, le vendeur lit les siennes ; écrites par le worker.
ALTER TABLE "CommissionInvoice" ENABLE ROW LEVEL SECURITY;
CREATE POLICY finance_read ON "CommissionInvoice" FOR SELECT
  USING (app_platform_role()::text IN ('FINANCE', 'ADMIN'));
CREATE POLICY tenant_read ON "CommissionInvoice" FOR SELECT USING ("tenantId" = app_tenant_id());
GRANT SELECT ON "CommissionInvoice" TO duoshop_app;
ALTER TABLE "CommissionInvoiceLine" ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoice_read ON "CommissionInvoiceLine" FOR SELECT
  USING (EXISTS (SELECT 1 FROM "CommissionInvoice" i WHERE i."id" = "invoiceId"));
GRANT SELECT ON "CommissionInvoiceLine" TO duoshop_app;
ALTER TABLE "InvoiceCounter" ENABLE ROW LEVEL SECURITY;

-- ---------- Paramètres (FINANCE, À VALIDER PAR EXPERT-COMPTABLE) ----------
INSERT INTO "ParameterDefinition" ("key", "kind", "ownerRole", "storeScoped", "minValue", "maxValue", "labelFr", "labelEn") VALUES
  ('vat.commission_rate', 'rate', 'FINANCE', false, '0', '0.5',
   'TVA sur la commission (taux, commission TVA comprise)', 'VAT on commission (rate, commission includes VAT)'),
  ('psp.fee_rate.fapshi', 'rate', 'FINANCE', false, '0', '0.2',
   'Frais Fapshi par encaissement', 'Fapshi fee per collection'),
  ('fees.borne_by', 'text', 'FINANCE', true, NULL, NULL,
   'Frais du prestataire supportés par : PLATFORM ou SELLER', 'Provider fees borne by: PLATFORM or SELLER'),
  ('commission.recognition', 'text', 'FINANCE', false, NULL, NULL,
   'Commission acquise : HANDOVER (remise) ou CLAIM_WINDOW_END (fin du délai de réclamation)',
   'Commission earned: HANDOVER or CLAIM_WINDOW_END'),
  ('commission.invoice_due', 'duration', 'FINANCE', false, '1 day', '180 days',
   'Échéance de paiement d''une facture de commission', 'Commission invoice payment term'),
  ('platform.legal_name', 'text', 'FINANCE', false, NULL, NULL,
   'Raison sociale de la plateforme (factures)', 'Platform legal name (invoices)'),
  ('platform.niu', 'text', 'FINANCE', false, NULL, NULL,
   'NIU de la plateforme (factures)', 'Platform tax number (invoices)'),
  ('platform.address', 'text', 'FINANCE', false, NULL, NULL,
   'Adresse de la plateforme (factures)', 'Platform address (invoices)');
INSERT INTO "RegulatoryParameter" ("id", "key", "value", "effectiveFrom", "legalBasis", "approvedAt") VALUES
  (gen_random_uuid(), 'vat.commission_rate', '"0.1925"', '2026-01-01T00:00:00Z',
   'Hypothèses H12 et H13. À valider par expert-comptable.', now()),
  (gen_random_uuid(), 'psp.fee_rate.fapshi', '"0.03"', '2026-01-01T00:00:00Z',
   'Documentation publique Fapshi (H24). À valider par le prestataire.', now()),
  (gen_random_uuid(), 'fees.borne_by', '"PLATFORM"', '2026-01-01T00:00:00Z',
   'Choix provisoire : la plateforme supporte les frais. À décider.', now()),
  (gen_random_uuid(), 'commission.recognition', '"HANDOVER"', '2026-01-01T00:00:00Z',
   'Comportement d''origine (B08), hypothèse H15. À valider par expert-comptable.', now()),
  (gen_random_uuid(), 'commission.invoice_due', '"30 days"', '2026-01-01T00:00:00Z',
   'Hypothèse. À valider par expert-comptable.', now());
-- Identité de la plateforme : aucune valeur inventée ; la facturation attend sa saisie.

-- Valeur facultative : NULL si aucune période n'est en vigueur (au lieu d'une erreur).
CREATE FUNCTION param_value_or_null(p_key text, p_at timestamptz DEFAULT now(), p_store uuid DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN param_value(p_key, p_at, p_store);
EXCEPTION WHEN no_data_found THEN
  RETURN NULL;
END
$$;
-- Arrondi half-up d'un montant entier multiplié par un taux décimal.
CREATE FUNCTION round_half_up(p_amount bigint, p_rate numeric) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT floor(p_amount * p_rate + 0.5)::bigint $$;
-- TVA comprise dans un montant TTC.
CREATE FUNCTION vat_included(p_amount bigint, p_rate numeric) RETURNS bigint
LANGUAGE sql IMMUTABLE AS $$ SELECT floor(p_amount * p_rate / (1 + p_rate) + 0.5)::bigint $$;

-- ---------- Constatation de la commission ----------
-- Commission restant après les reprises prises sur le différé ; TVA extraite au taux du jour.
CREATE FUNCTION recognize_commission(p_seller_order uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_so "SellerOrder"%ROWTYPE;
  v_currency text;
  v_amount bigint;
  v_vat bigint;
BEGIN
  SELECT * INTO v_so FROM "SellerOrder" WHERE "id" = p_seller_order FOR UPDATE;
  IF NOT FOUND OR v_so."commissionRecognizedMinor" IS NOT NULL THEN RETURN false; END IF;
  SELECT "currency" INTO v_currency FROM "Order" WHERE "id" = v_so."orderId";
  SELECT coalesce(v_so."commissionMinor", 0) - coalesce(sum(r."commissionReversedMinor"), 0)
    INTO v_amount
    FROM "Refund" r JOIN "Claim" c ON c."id" = r."claimId"
   WHERE c."sellerOrderId" = v_so."id" AND r."reversedFrom" = 'DEFERRED';
  v_amount := greatest(v_amount, 0);
  v_vat := vat_included(v_amount, coalesce(param_value_or_null('vat.commission_rate'), '0')::numeric);
  UPDATE "SellerOrder" SET "commissionRecognizedMinor" = v_amount, "commissionVatMinor" = v_vat
   WHERE "id" = v_so."id";
  PERFORM post_journal('commission_earned', v_so."id"::text, v_currency,
    'Commission acquise — ' || v_so."storeName" || ' — ' || upper(left(v_so."orderId"::text, 8)),
    jsonb_build_array(
      jsonb_build_object('account', 'COMMISSION_DEFERRED', 'amount', v_amount),
      jsonb_build_object('account', 'COMMISSION_REVENUE', 'amount', -(v_amount - v_vat)),
      jsonb_build_object('account', 'VAT_COLLECTED', 'amount', -v_vat)));
  RETURN true;
END
$$;

-- Remise prouvée : constatation immédiate si la règle figée au paiement est HANDOVER.
CREATE OR REPLACE FUNCTION on_seller_order_delivered() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF coalesce(NEW."commissionRecognition", 'HANDOVER') = 'HANDOVER' THEN
    PERFORM recognize_commission(NEW."id");
  END IF;
  RETURN NULL;
END
$$;

-- Fin du délai de réclamation (règle CLAIM_WINDOW_END) : passe du worker, sans réclamation active.
CREATE FUNCTION recognize_due_commissions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id uuid;
  v_count integer := 0;
BEGIN
  FOR v_id IN
    SELECT so."id" FROM "SellerOrder" so
     WHERE so."commissionRecognition" = 'CLAIM_WINDOW_END' AND so."commissionRecognizedMinor" IS NULL
       AND so."fulfilmentStatus" = 'DELIVERED'
       AND so."deliveredAt" + param_interval('claims.window', so."deliveredAt") < now()
       AND NOT EXISTS (SELECT 1 FROM "Claim" c WHERE c."sellerOrderId" = so."id"
                         AND c."status" IN ('OPEN', 'REJECTED', 'ESCALATED'))
     LIMIT 500
  LOOP
    IF recognize_commission(v_id) THEN v_count := v_count + 1; END IF;
  END LOOP;
  RETURN v_count;
END
$$;

-- ---------- Frais du prestataire ----------
-- Part d'une sous-commande dans les frais d'un encaissement par la plateforme ; à la charge de
-- la plateforme ou du vendeur selon le paramètre de la boutique.
CREATE FUNCTION book_psp_fee(p_source text, p_currency text, p_provider text, p_base bigint,
  p_tenant uuid, p_store uuid, p_description text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rate text := param_value_or_null('psp.fee_rate.' || p_provider);
  v_fee bigint;
  v_seller boolean;
BEGIN
  IF v_rate IS NULL THEN RETURN; END IF;
  v_fee := round_half_up(p_base, v_rate::numeric);
  v_seller := p_store IS NOT NULL
    AND coalesce(param_value_or_null('fees.borne_by', now(), p_store), 'PLATFORM') = 'SELLER';
  PERFORM post_journal('psp_fee', p_source, p_currency, p_description,
    jsonb_build_array(
      CASE WHEN v_seller
        THEN jsonb_build_object('account', 'SELLER_PAYABLE', 'tenantId', p_tenant, 'amount', v_fee)
        ELSE jsonb_build_object('account', 'PSP_FEES', 'amount', v_fee) END,
      jsonb_build_object('account', 'PSP_CLEARING', 'amount', -v_fee)));
END
$$;

-- ---------- Factures de commission ----------
CREATE FUNCTION next_invoice_number(p_series text, p_year integer) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_number integer;
BEGIN
  INSERT INTO "InvoiceCounter" ("series", "fiscalYear") VALUES (p_series, p_year)
  ON CONFLICT DO NOTHING;
  -- Verrou de ligne : numéros consécutifs, sans trou, dans la transaction de la facture.
  SELECT "next" INTO v_number FROM "InvoiceCounter"
   WHERE "series" = p_series AND "fiscalYear" = p_year FOR UPDATE;
  UPDATE "InvoiceCounter" SET "next" = "next" + 1 WHERE "series" = p_series AND "fiscalYear" = p_year;
  RETURN v_number;
END
$$;

-- Factures (commissions constatées) et avoirs (commissions reprises après facturation) d'une
-- période, une pièce par boutique et par type. Rejouable : rien n'est facturé deux fois.
-- Refusé tant que l'identité de la plateforme (raison sociale, NIU) n'est pas saisie.
CREATE FUNCTION issue_commission_invoices(p_from date, p_to date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_platform jsonb;
  v_store record;
  v_invoice uuid;
  v_kind "InvoiceKind";
  v_series text;
  v_year integer := extract(year FROM p_from)::integer;
  v_count integer := 0;
  v_from timestamptz := (p_from::timestamp AT TIME ZONE 'Africa/Douala');
  v_to timestamptz := ((p_to + 1)::timestamp AT TIME ZONE 'Africa/Douala');
BEGIN
  IF param_value_or_null('platform.legal_name') IS NULL OR param_value_or_null('platform.niu') IS NULL THEN
    RAISE EXCEPTION 'platform_identity_missing' USING ERRCODE = 'P0002';
  END IF;
  v_platform := jsonb_build_object('legalName', param_value_or_null('platform.legal_name'),
    'niu', param_value_or_null('platform.niu'), 'address', param_value_or_null('platform.address'));
  FOREACH v_kind IN ARRAY ARRAY['INVOICE', 'CREDIT_NOTE']::"InvoiceKind"[] LOOP
    v_series := CASE WHEN v_kind = 'INVOICE' THEN 'FC' ELSE 'AV' END;
    FOR v_store IN
      WITH lines AS (
        SELECT so."tenantId", so."storeId", so."id" AS so_id, NULL::uuid AS refund_id,
               upper(left(so."orderId"::text, 8)) AS ref,
               so."commissionRecognizedMinor" AS ttc, so."commissionVatMinor" AS vat, j."currency"
          FROM "SellerOrder" so
          JOIN "LedgerJournal" j ON j."kind" = 'commission_earned' AND j."sourceId" = so."id"::text
         WHERE v_kind = 'INVOICE' AND j."occurredAt" >= v_from AND j."occurredAt" < v_to
           AND coalesce(so."commissionRecognizedMinor", 0) > 0
           AND NOT EXISTS (SELECT 1 FROM "CommissionInvoiceLine" l
                            WHERE l."kind" = 'INVOICE' AND l."sellerOrderId" = so."id")
        UNION ALL
        SELECT so."tenantId", so."storeId", so."id", r."id", upper(left(so."orderId"::text, 8)),
               r."commissionReversedMinor", coalesce(r."commissionVatReversedMinor", 0), r."currency"
          FROM "Refund" r
          JOIN "Claim" c ON c."id" = r."claimId"
          JOIN "SellerOrder" so ON so."id" = c."sellerOrderId"
         WHERE v_kind = 'CREDIT_NOTE' AND r."reversedFrom" = 'REVENUE' AND r."commissionReversedMinor" > 0
           AND r."createdAt" >= v_from AND r."createdAt" < v_to
           AND EXISTS (SELECT 1 FROM "CommissionInvoiceLine" l
                        WHERE l."kind" = 'INVOICE' AND l."sellerOrderId" = so."id")
           AND NOT EXISTS (SELECT 1 FROM "CommissionInvoiceLine" l
                            WHERE l."kind" = 'CREDIT_NOTE' AND l."refundId" = r."id")
      )
      SELECT "tenantId", "storeId", "currency", sum(ttc)::bigint AS ttc, sum(vat)::bigint AS vat,
             jsonb_agg(jsonb_build_object('so', so_id, 'refund', refund_id, 'ref', ref,
                                          'ttc', ttc, 'vat', vat)) AS items
        FROM lines GROUP BY "tenantId", "storeId", "currency"
    LOOP
      v_invoice := gen_random_uuid();
      INSERT INTO "CommissionInvoice" ("id", "kind", "series", "fiscalYear", "number", "tenantId",
        "storeId", "periodStart", "periodEnd", "totalTtcMinor", "vatMinor", "totalHtMinor", "vatRate",
        "currency", "seller", "platform", "dueAt")
      VALUES (v_invoice, v_kind, v_series, v_year, next_invoice_number(v_series, v_year),
        v_store."tenantId", v_store."storeId", p_from, p_to, v_store.ttc, v_store.vat,
        v_store.ttc - v_store.vat, coalesce(param_value_or_null('vat.commission_rate'), '0'),
        v_store."currency",
        coalesce(store_legal_mentions(v_store."storeId"), '{}'::jsonb)
          || jsonb_build_object('storeName', (SELECT "name" FROM "Store" WHERE "id" = v_store."storeId")),
        v_platform, now() + param_interval('commission.invoice_due'));
      INSERT INTO "CommissionInvoiceLine" ("id", "invoiceId", "kind", "sellerOrderId", "refundId",
        "orderReference", "totalTtcMinor", "vatMinor")
      SELECT gen_random_uuid(), v_invoice, v_kind, (i->>'so')::uuid, NULLIF(i->>'refund', '')::uuid,
             i->>'ref', (i->>'ttc')::bigint, (i->>'vat')::bigint
        FROM jsonb_array_elements(v_store.items) i;
      v_count := v_count + 1;
    END LOOP;
  END LOOP;
  RETURN v_count;
END
$$;

-- Paiement d'une facture par le vendeur (mode direct), constaté par la finance.
CREATE FUNCTION mark_invoice_paid(p_invoice uuid, p_reference text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE i "CommissionInvoice"%ROWTYPE;
BEGIN
  IF app_platform_role()::text IS DISTINCT FROM 'FINANCE' THEN RETURN 'forbidden'; END IF;
  IF char_length(btrim(coalesce(p_reference, ''))) < 3 THEN RETURN 'reference_required'; END IF;
  SELECT * INTO i FROM "CommissionInvoice" WHERE "id" = p_invoice FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF i."paidAt" IS NOT NULL THEN RETURN 'already_paid'; END IF;
  IF i."kind" <> 'INVOICE' THEN RETURN 'not_invoice'; END IF;
  UPDATE "CommissionInvoice" SET "paidAt" = now(), "paidReference" = btrim(p_reference)
   WHERE "id" = p_invoice;
  INSERT INTO "ConfigAudit" ("id", "actorId", "entity", "entityId", "action", "after")
  VALUES (gen_random_uuid(), app_user_id(), 'CommissionInvoice', p_invoice, 'paid',
    jsonb_build_object('reference', btrim(p_reference)));
  RETURN 'paid';
END
$$;

REVOKE ALL ON FUNCTION param_value_or_null(text, timestamptz, uuid), recognize_commission(uuid),
  recognize_due_commissions(), book_psp_fee(text, text, text, bigint, uuid, uuid, text),
  next_invoice_number(text, integer), issue_commission_invoices(date, date),
  mark_invoice_paid(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mark_invoice_paid(uuid, text) TO duoshop_app;
-- recognize_due_commissions et issue_commission_invoices : worker (connexion propriétaire).

-- ---------- Fonctions modifiées (corps d'origine, changements ciblés) ----------
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
  v_provider text;
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
         "sellerNetMinor" = v_net,
         -- Règle de constatation figée au paiement (lot 4) : jamais requalifiée ensuite.
         "commissionRecognition" = coalesce(param_value_or_null('commission.recognition'), 'HANDOVER')
   WHERE "id" = v_so."id";
  -- Mode du paiement qui a confirmé la commande (lot 3) : en mode direct, l'argent est chez le
  -- vendeur ; la plateforme ne constate qu'une créance de commission sur lui.
  SELECT p."collectionMode", p."provider" INTO v_mode, v_provider FROM "Payment" p
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
  -- Frais du prestataire sur la part de cette sous-commande (lot 4).
  PERFORM book_psp_fee(v_so."id"::text, v_currency, v_provider, v_net + v_commission,
    v_so."tenantId", v_so."storeId",
    'Frais du prestataire — ' || v_so."storeName" || ' — ' || upper(left(v_so."orderId"::text, 8)));
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
  v_earned boolean;
  v_vat bigint;
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
  -- Lot 4 : commission déjà constatée => reprise sur le revenu et sur la TVA (même proportion
  -- qu'à la constatation, arrondi half-up) ; sinon reprise sur la commission différée.
  v_earned := v_so."commissionRecognizedMinor" IS NOT NULL;
  v_vat := CASE WHEN v_earned AND v_so."commissionRecognizedMinor" > 0
             THEN (v_reversal * coalesce(v_so."commissionVatMinor", 0) * 2 + v_so."commissionRecognizedMinor")
                  / (2 * v_so."commissionRecognizedMinor")
             ELSE 0 END;
  -- Mode direct (lot 3) : le vendeur détient l'argent et exécute le remboursement lui-même.
  INSERT INTO "Refund" ("id", "claimId", "tenantId", "orderId", "buyerId", "paymentId", "amountMinor",
    "commissionReversedMinor", "sellerDebitMinor", "currency", "status", "commissionVatReversedMinor",
    "reversedFrom")
  VALUES (v_refund, v_c."id", v_c."tenantId", v_c."orderId", v_c."buyerId", v_payment, v_c."amountMinor",
    v_reversal, v_c."amountMinor" - v_reversal, v_c."currency",
    CASE WHEN v_mode = 'DIRECT_SELLER' THEN 'SELLER_TO_EXECUTE' ELSE 'PENDING_PROVIDER' END::"RefundStatus",
    v_vat, CASE WHEN v_earned THEN 'REVENUE' ELSE 'DEFERRED' END);
  IF v_mode = 'DIRECT_SELLER' THEN
    -- Seule la commission reprise touche la plateforme : la créance sur le vendeur diminue.
    PERFORM post_journal('refund_decided', v_refund::text, v_c."currency",
      'Remboursement à exécuter par le vendeur — ' || v_so."storeName" || ' — ' || upper(left(v_c."orderId"::text, 8)),
      jsonb_build_array(
        jsonb_build_object('account', CASE WHEN v_earned THEN 'COMMISSION_REVENUE' ELSE 'COMMISSION_DEFERRED' END,
                           'amount', v_reversal - v_vat),
        jsonb_build_object('account', 'VAT_COLLECTED', 'amount', v_vat),
        jsonb_build_object('account', 'COMMISSION_RECEIVABLE', 'tenantId', v_c."tenantId", 'amount', -v_reversal)));
    RETURN;
  END IF;
  PERFORM post_journal('refund_decided', v_refund::text, v_c."currency",
    'Remboursement décidé — ' || v_so."storeName" || ' — ' || upper(left(v_c."orderId"::text, 8)),
    jsonb_build_array(
      jsonb_build_object('account', 'SELLER_PAYABLE', 'tenantId', v_c."tenantId",
                         'amount', v_c."amountMinor" - v_reversal),
      jsonb_build_object('account', CASE WHEN v_earned THEN 'COMMISSION_REVENUE' ELSE 'COMMISSION_DEFERRED' END,
                         'amount', v_reversal - v_vat),
      jsonb_build_object('account', 'VAT_COLLECTED', 'amount', v_vat),
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
  -- Frais prélevés même sur un paiement à rembourser : à la charge de la plateforme (lot 4).
  PERFORM book_psp_fee(NEW."id"::text, NEW."currency", NEW."provider", NEW."amountMinor", NULL, NULL,
    'Frais du prestataire — paiement à rembourser');
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
  ), receivables AS (
    SELECT e."tenantId", j."currency", sum(e."amountMinor")::text AS amount,
           (SELECT string_agg(s."name", ', ') FROM "Store" s WHERE s."tenantId" = e."tenantId") AS stores
      FROM "LedgerEntry" e JOIN "LedgerJournal" j ON j."id" = e."journalId"
     WHERE e."account" = 'COMMISSION_RECEIVABLE'
     GROUP BY e."tenantId", j."currency"
    HAVING sum(e."amountMinor") <> 0
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
       -- Mode direct (lot 3) : l'argent va au vendeur, aucun fonds chez le prestataire.
       AND p."collectionMode" <> 'DIRECT_SELLER'
  ), daily AS (
    SELECT d.day,
           coalesce((SELECT sum(p."amountMinor") FROM "Payment" p WHERE p."status" = 'SUCCEEDED'
                      AND p."collectionMode" <> 'DIRECT_SELLER'
                      AND (p."settledAt" AT TIME ZONE 'Africa/Douala')::date = d.day), 0) AS settled,
           coalesce((SELECT sum(e."amountMinor") FROM "LedgerJournal" j JOIN "LedgerEntry" e ON e."journalId" = j."id"
                      WHERE e."account" = 'PSP_CLEARING'
                        -- Encaissements seulement : les frais (lot 4) se rapprochent avec le relevé.
                        AND j."kind" IN ('order_paid', 'unapplied_payment')
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
    -- Facture de commission échue alors que le vendeur doit encore une commission (mode direct).
    SELECT 'invoice_overdue', i."id"::text, i."totalTtcMinor"::text, NULL
      FROM "CommissionInvoice" i
     WHERE i."kind" = 'INVOICE' AND i."paidAt" IS NULL AND i."dueAt" < now()
       AND EXISTS (SELECT 1 FROM receivables r WHERE r."tenantId" = i."tenantId" AND r.amount::bigint > 0)
    UNION ALL
    SELECT 'unbalanced_journal', j."id"::text, '0', sum(e."amountMinor")::text
      FROM "LedgerJournal" j JOIN "LedgerEntry" e ON e."journalId" = j."id"
     GROUP BY j."id" HAVING sum(e."amountMinor") <> 0
  )
  SELECT jsonb_build_object(
    'balances', coalesce((SELECT jsonb_agg(to_jsonb(b)) FROM balances b), '[]'::jsonb),
    'payables', coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM payables p), '[]'::jsonb),
    'receivables', coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM receivables r), '[]'::jsonb),
    'anomalies', coalesce((SELECT jsonb_agg(to_jsonb(a)) FROM anomalies a), '[]'::jsonb),
    'daily', coalesce((SELECT jsonb_agg(jsonb_build_object('day', day, 'settled', settled::text, 'posted', posted::text) ORDER BY day) FROM daily), '[]'::jsonb)
  ) INTO v_result;
  RETURN v_result;
END
$$;
