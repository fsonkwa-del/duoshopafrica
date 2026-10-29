-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('AWAITING_PAYMENT', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "DeliveryMethod" AS ENUM ('HOME_DELIVERY', 'PICKUP');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "deliveryFeeMinor" BIGINT,
ADD COLUMN     "pickupEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pickupInstructions" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Address" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "recipientName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "landmark" TEXT NOT NULL,
    "details" TEXT,
    "latitude" DECIMAL(7,4),
    "longitude" DECIMAL(7,4),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "buyerId" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "currency" CHAR(3) NOT NULL,
    "itemsTotalMinor" BIGINT NOT NULL,
    "deliveryTotalMinor" BIGINT NOT NULL,
    "totalMinor" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "addressSnapshot" JSONB,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerOrder" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "storeId" UUID NOT NULL,
    "storeName" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'AWAITING_PAYMENT',
    "deliveryMethod" "DeliveryMethod" NOT NULL,
    "deliveryFeeMinor" BIGINT NOT NULL,
    "itemsTotalMinor" BIGINT NOT NULL,
    "pickupInstructions" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderItem" (
    "id" UUID NOT NULL,
    "sellerOrderId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "variantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "lineTotalMinor" BIGINT NOT NULL,
    "reservationRef" TEXT NOT NULL,

    CONSTRAINT "OrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Address_userId_idx" ON "Address"("userId");

-- CreateIndex
CREATE INDEX "Order_status_expiresAt_idx" ON "Order"("status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_buyerId_idempotencyKey_key" ON "Order"("buyerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "SellerOrder_storeId_createdAt_idx" ON "SellerOrder"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "SellerOrder_orderId_idx" ON "SellerOrder"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerOrder_tenantId_id_key" ON "SellerOrder"("tenantId", "id");

-- CreateIndex
CREATE INDEX "OrderItem_sellerOrderId_idx" ON "OrderItem"("sellerOrderId");

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_tenantId_storeId_fkey" FOREIGN KEY ("tenantId", "storeId") REFERENCES "Store"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_tenantId_sellerOrderId_fkey" FOREIGN KEY ("tenantId", "sellerOrderId") REFERENCES "SellerOrder"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariants en base : montants cohérents et positifs, quantités bornées, données d'adresse saines.
ALTER TABLE "Store" ADD CONSTRAINT "Store_deliveryFee_nonnegative" CHECK ("deliveryFeeMinor" IS NULL OR "deliveryFeeMinor" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_totals_consistent"
  CHECK ("itemsTotalMinor" > 0 AND "deliveryTotalMinor" >= 0 AND "totalMinor" = "itemsTotalMinor" + "deliveryTotalMinor");
ALTER TABLE "SellerOrder" ADD CONSTRAINT "SellerOrder_amounts_valid"
  CHECK ("itemsTotalMinor" > 0 AND "deliveryFeeMinor" >= 0);
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_line_consistent"
  CHECK ("quantity" BETWEEN 1 AND 99 AND "unitPriceMinor" > 0 AND "lineTotalMinor" = "unitPriceMinor" * "quantity");
ALTER TABLE "Address" ADD CONSTRAINT "Address_phone_e164" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');
ALTER TABLE "Address" ADD CONSTRAINT "Address_coordinates_valid"
  CHECK (("latitude" IS NULL) = ("longitude" IS NULL)
     AND ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90)
     AND ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180));

-- RLS : l'acheteur voit ses adresses et commandes ; le vendeur voit ses sous-commandes (tenant).
ALTER TABLE "Address" ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON "Address" USING ("userId" = app_user_id());
ALTER TABLE "Order" ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_scope ON "Order" USING ("buyerId" = app_user_id());
ALTER TABLE "SellerOrder" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "SellerOrder" USING ("tenantId" = app_tenant_id());
CREATE POLICY buyer_scope ON "SellerOrder" USING (
  EXISTS (SELECT 1 FROM "Order" o WHERE o."id" = "orderId" AND o."buyerId" = app_user_id()));
ALTER TABLE "OrderItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_scope ON "OrderItem" USING ("tenantId" = app_tenant_id());
CREATE POLICY buyer_scope ON "OrderItem" USING (
  EXISTS (SELECT 1 FROM "SellerOrder" so JOIN "Order" o ON o."id" = so."orderId"
           WHERE so."id" = "sellerOrderId" AND o."buyerId" = app_user_id()));

GRANT SELECT, INSERT ON "Address", "Order", "SellerOrder", "OrderItem" TO duoshop_app;
GRANT UPDATE ("archivedAt") ON "Address" TO duoshop_app;
GRANT UPDATE ("deliveryFeeMinor", "pickupEnabled", "pickupInstructions", "version") ON "Store" TO duoshop_app;
-- Statuts de commande : modifiés uniquement par cancel_order (SECURITY DEFINER), jamais directement.

-- Réservation pour une commande, depuis le contexte acheteur (sans entrer dans le tenant vendeur).
-- Seules des variantes publiques sont réservables ; même référence => rejeu, sinon conflit.
CREATE FUNCTION reserve_public_stock(p_variant uuid, p_quantity integer, p_reference text, p_expires timestamptz)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid;
  v_location uuid;
  v_previous "StockReservation"%ROWTYPE;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 99 OR p_reference NOT LIKE 'order:%' THEN
    RAISE EXCEPTION 'invalid reservation request' USING ERRCODE = '22023';
  END IF;
  IF NOT variant_is_public(p_variant) THEN
    RETURN 'unavailable';
  END IF;
  SELECT "tenantId" INTO v_tenant FROM "ProductVariant" WHERE "id" = p_variant;
  SELECT * INTO v_previous FROM "StockReservation"
   WHERE "tenantId" = v_tenant AND "reference" = p_reference;
  IF FOUND THEN
    RETURN CASE WHEN v_previous."variantId" = p_variant AND v_previous."quantity" = p_quantity
                THEN 'replayed' ELSE 'conflict' END;
  END IF;
  UPDATE "StockLevel" s
     SET "reserved" = s."reserved" + p_quantity, "updatedAt" = now()
   WHERE (s."variantId", s."locationId") = (
           SELECT c."variantId", c."locationId" FROM "StockLevel" c
            WHERE c."variantId" = p_variant AND c."onHand" - c."reserved" >= p_quantity
            ORDER BY c."onHand" - c."reserved" DESC
            LIMIT 1 FOR UPDATE)
     AND s."onHand" - s."reserved" >= p_quantity
  RETURNING s."locationId" INTO v_location;
  IF v_location IS NULL THEN
    RETURN 'insufficient';
  END IF;
  INSERT INTO "StockReservation" ("id", "tenantId", "variantId", "locationId", "quantity", "reference", "expiresAt")
  VALUES (gen_random_uuid(), v_tenant, p_variant, v_location, p_quantity, p_reference, p_expires);
  RETURN 'reserved';
END
$$;

-- Clôture d'une commande non payée : annulation par l'acheteur lui-même, ou expiration échue.
-- Libère ses réservations encore actives (une libération déjà faite par le worker n'est pas refaite).
CREATE FUNCTION close_unpaid_order(p_order uuid, p_status "OrderStatus")
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status = 'CANCELLED' THEN
    UPDATE "Order" SET "status" = 'CANCELLED', "closedAt" = now()
     WHERE "id" = p_order AND "status" = 'AWAITING_PAYMENT' AND "buyerId" = app_user_id();
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

CREATE FUNCTION expire_unpaid_orders(p_limit integer)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_order uuid;
  v_count integer := 0;
BEGIN
  FOR v_order IN
    SELECT "id" FROM "Order"
     WHERE "status" = 'AWAITING_PAYMENT' AND "expiresAt" < now()
     ORDER BY "expiresAt" LIMIT greatest(p_limit, 0)
     FOR UPDATE SKIP LOCKED
  LOOP
    IF close_unpaid_order(v_order, 'EXPIRED') THEN
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN v_count;
END
$$;

REVOKE ALL ON FUNCTION reserve_public_stock(uuid, integer, text, timestamptz),
  close_unpaid_order(uuid, "OrderStatus"), expire_unpaid_orders(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reserve_public_stock(uuid, integer, text, timestamptz),
  close_unpaid_order(uuid, "OrderStatus"), expire_unpaid_orders(integer) TO duoshop_app;
