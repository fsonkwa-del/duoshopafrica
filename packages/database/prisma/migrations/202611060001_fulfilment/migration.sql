-- CreateEnum
CREATE TYPE "FulfilmentStatus" AS ENUM ('AWAITING_PAYMENT', 'TO_PREPARE', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', 'DELIVERED');

-- AlterTable
ALTER TABLE "SellerOrder" ADD COLUMN     "deliveredAt" TIMESTAMPTZ(3),
ADD COLUMN     "fulfilmentStatus" "FulfilmentStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
ADD COLUMN     "fulfilmentVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "handoverAttempts" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "HandoverCode" (
    "sellerOrderId" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "code" CHAR(6) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoverCode_pkey" PRIMARY KEY ("sellerOrderId")
);

-- CreateTable
CREATE TABLE "FulfilmentEvent" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "status" "FulfilmentStatus" NOT NULL,
    "note" TEXT,
    "actorId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfilmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "orderId" UUID,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMPTZ(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FulfilmentEvent_sellerOrderId_createdAt_idx" ON "FulfilmentEvent"("sellerOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "FulfilmentEvent_orderId_idx" ON "FulfilmentEvent"("orderId");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "HandoverCode" ADD CONSTRAINT "HandoverCode_sellerOrderId_fkey" FOREIGN KEY ("sellerOrderId") REFERENCES "SellerOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FulfilmentEvent" ADD CONSTRAINT "FulfilmentEvent_tenantId_sellerOrderId_fkey" FOREIGN KEY ("tenantId", "sellerOrderId") REFERENCES "SellerOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- ---------- Écrit à la main : remise, code, historique, notifications ----------
ALTER TABLE "HandoverCode" ADD CONSTRAINT "HandoverCode_six_digits" CHECK ("code" ~ '^[0-9]{6}$');
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_handover_attempts" CHECK ("handoverAttempts" BETWEEN 0 AND 5);
ALTER TABLE "FulfilmentEvent" ADD CONSTRAINT "FulfilmentEvent_note_length" CHECK (char_length(coalesce("note", '')) <= 300);

-- Code : l'acheteur seul le lit ; le vendeur ne peut que le soumettre à advance_fulfilment.
ALTER TABLE "HandoverCode" ENABLE ROW LEVEL SECURITY;
CREATE POLICY buyer_scope ON "HandoverCode" FOR SELECT USING ("buyerId" = app_user_id());
ALTER TABLE "FulfilmentEvent" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "FulfilmentEvent" FOR SELECT USING ("tenantId" = app_tenant_id());
CREATE POLICY buyer_scope ON "FulfilmentEvent" FOR SELECT USING (
  EXISTS (SELECT 1 FROM "Order" o WHERE o."id" = "orderId" AND o."buyerId" = app_user_id()));
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON "Notification" USING ("userId" = app_user_id());
GRANT SELECT ON "HandoverCode", "FulfilmentEvent" TO duoshop_app;
GRANT SELECT ON "Notification" TO duoshop_app;
GRANT UPDATE ("readAt") ON "Notification" TO duoshop_app;

-- Code à 6 chiffres tiré de gen_random_uuid (générateur fort de PostgreSQL).
CREATE FUNCTION new_handover_code() RETURNS text LANGUAGE sql VOLATILE AS $$
  SELECT lpad((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0')
$$;

-- Notifie l'acheteur et l'équipe active de la boutique (propriétaire, gérants, préparateurs).
CREATE FUNCTION notify_fulfilment(p_seller_order uuid, p_kind text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_so "SellerOrder"%ROWTYPE;
  v_buyer uuid;
BEGIN
  SELECT * INTO v_so FROM "SellerOrder" WHERE "id" = p_seller_order;
  SELECT "buyerId" INTO v_buyer FROM "Order" WHERE "id" = v_so."orderId";
  INSERT INTO "Notification" ("id", "userId", "kind", "orderId", "data")
  VALUES (gen_random_uuid(), v_buyer, p_kind, v_so."orderId",
          jsonb_build_object('storeName', v_so."storeName", 'status', v_so."fulfilmentStatus",
                             'deliveryMethod', v_so."deliveryMethod"));
  IF p_kind = 'order_paid' THEN
    INSERT INTO "Notification" ("id", "userId", "kind", "orderId", "data")
    SELECT gen_random_uuid(), m."userId", 'seller_order_paid', NULL,
           jsonb_build_object('storeId', v_so."storeId", 'storeName', v_so."storeName",
                              'reference', upper(left(v_so."orderId"::text, 8)))
      FROM "StoreMember" m
     WHERE m."storeId" = v_so."storeId" AND m."active"
       AND m."role" IN ('OWNER', 'MANAGER', 'FULFILLMENT');
  END IF;
  -- Canaux externes (SMS, WhatsApp) : lus plus tard dans l'outbox par un expéditeur dédié.
  INSERT INTO "OutboxEvent" ("id", "tenantId", "kind", "aggregateId", "payload")
  VALUES (gen_random_uuid(), v_so."tenantId", 'fulfilment.' || p_kind, v_so."id"::text,
          jsonb_build_object('orderId', v_so."orderId", 'status', v_so."fulfilmentStatus"));
END
$$;

-- Paiement confirmé (statut PAID posé par apply_payment_event) : à préparer, code de remise,
-- premier jalon de l'historique et notifications.
CREATE FUNCTION on_seller_order_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_buyer uuid;
BEGIN
  SELECT "buyerId" INTO v_buyer FROM "Order" WHERE "id" = NEW."orderId";
  UPDATE "SellerOrder" SET "fulfilmentStatus" = 'TO_PREPARE' WHERE "id" = NEW."id";
  INSERT INTO "HandoverCode" ("sellerOrderId", "buyerId", "code")
  VALUES (NEW."id", v_buyer, new_handover_code()) ON CONFLICT DO NOTHING;
  INSERT INTO "FulfilmentEvent" ("id", "tenantId", "sellerOrderId", "orderId", "status")
  VALUES (gen_random_uuid(), NEW."tenantId", NEW."id", NEW."orderId", 'TO_PREPARE');
  PERFORM notify_fulfilment(NEW."id", 'order_paid');
  RETURN NULL;
END
$$;
CREATE TRIGGER seller_order_paid AFTER UPDATE OF "status" ON "SellerOrder"
  FOR EACH ROW WHEN (OLD."status" IS DISTINCT FROM NEW."status" AND NEW."status" = 'PAID')
  EXECUTE FUNCTION on_seller_order_paid();

-- Étape suivante, depuis le contexte vendeur (tenant). Transitions identiques à
-- nextFulfilmentSteps (domaine) ; DELIVERED exige le code de l'acheteur (5 essais au plus).
CREATE FUNCTION advance_fulfilment(p_seller_order uuid, p_to "FulfilmentStatus", p_note text,
  p_code text, p_expected_version integer)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_so "SellerOrder"%ROWTYPE;
  v_code text;
  v_allowed boolean;
BEGIN
  SELECT * INTO v_so FROM "SellerOrder"
   WHERE "id" = p_seller_order AND "tenantId" = app_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF v_so."status" <> 'PAID' THEN RETURN 'not_paid'; END IF;
  IF p_expected_version IS NOT NULL AND v_so."fulfilmentVersion" <> p_expected_version THEN
    RETURN 'stale_version';
  END IF;
  v_allowed := CASE v_so."fulfilmentStatus"
    WHEN 'TO_PREPARE' THEN p_to = 'READY'
    WHEN 'READY' THEN (v_so."deliveryMethod" = 'PICKUP' AND p_to = 'DELIVERED')
                   OR (v_so."deliveryMethod" = 'HOME_DELIVERY' AND p_to = 'OUT_FOR_DELIVERY')
    WHEN 'OUT_FOR_DELIVERY' THEN p_to IN ('DELIVERED', 'DELIVERY_FAILED')
    WHEN 'DELIVERY_FAILED' THEN p_to = 'OUT_FOR_DELIVERY'
    ELSE false END;
  IF NOT v_allowed THEN RETURN 'invalid_transition'; END IF;
  IF p_to = 'DELIVERY_FAILED' AND char_length(btrim(coalesce(p_note, ''))) < 3 THEN
    RETURN 'note_required';
  END IF;
  IF p_to = 'DELIVERED' THEN
    IF v_so."handoverAttempts" >= 5 THEN RETURN 'code_locked'; END IF;
    IF p_code IS NULL OR p_code !~ '^[0-9]{6}$' THEN RETURN 'code_required'; END IF;
    SELECT "code" INTO v_code FROM "HandoverCode" WHERE "sellerOrderId" = v_so."id";
    IF v_code IS NULL OR v_code <> p_code THEN
      UPDATE "SellerOrder" SET "handoverAttempts" = "handoverAttempts" + 1 WHERE "id" = v_so."id";
      RETURN CASE WHEN v_so."handoverAttempts" + 1 >= 5 THEN 'code_locked' ELSE 'code_invalid' END;
    END IF;
  END IF;
  UPDATE "SellerOrder"
     SET "fulfilmentStatus" = p_to, "fulfilmentVersion" = "fulfilmentVersion" + 1,
         "deliveredAt" = CASE WHEN p_to = 'DELIVERED' THEN now() ELSE "deliveredAt" END
   WHERE "id" = v_so."id";
  INSERT INTO "FulfilmentEvent" ("id", "tenantId", "sellerOrderId", "orderId", "status", "note", "actorId")
  VALUES (gen_random_uuid(), v_so."tenantId", v_so."id", v_so."orderId", p_to,
          NULLIF(btrim(coalesce(p_note, '')), ''), app_user_id());
  PERFORM notify_fulfilment(v_so."id", 'fulfilment_' || lower(p_to::text));
  RETURN 'ok';
END
$$;

REVOKE ALL ON FUNCTION notify_fulfilment(uuid, text), on_seller_order_paid(),
  advance_fulfilment(uuid, "FulfilmentStatus", text, text, integer), new_handover_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION advance_fulfilment(uuid, "FulfilmentStatus", text, text, integer) TO duoshop_app;

-- Reprise : sous-commandes déjà payées avant cette migration.
UPDATE "SellerOrder" SET "fulfilmentStatus" = 'TO_PREPARE' WHERE "status" = 'PAID';
INSERT INTO "HandoverCode" ("sellerOrderId", "buyerId", "code")
SELECT so."id", o."buyerId", new_handover_code()
  FROM "SellerOrder" so JOIN "Order" o ON o."id" = so."orderId"
 WHERE so."status" = 'PAID'
ON CONFLICT DO NOTHING;
INSERT INTO "FulfilmentEvent" ("id", "tenantId", "sellerOrderId", "orderId", "status")
SELECT gen_random_uuid(), so."tenantId", so."id", so."orderId", 'TO_PREPARE'
  FROM "SellerOrder" so WHERE so."status" = 'PAID';
