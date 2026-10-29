-- AlterTable
ALTER TABLE "Cart" ADD COLUMN     "guestTokenHash" CHAR(64),
ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Cart_guestTokenHash_key" ON "Cart"("guestTokenHash");


-- ---------- Écrit à la main : panier visiteur ----------
ALTER TABLE "Cart" ADD CONSTRAINT "Cart_single_owner"
  CHECK (("userId" IS NULL) <> ("guestTokenHash" IS NULL)
     AND ("guestTokenHash" IS NULL OR "guestTokenHash" ~ '^[0-9a-f]{64}$'));

-- Empreinte du jeton visiteur posée par l'API (set_config local à la transaction).
CREATE FUNCTION app_guest_cart() RETURNS text LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.guest_cart', true), '') $$;
GRANT EXECUTE ON FUNCTION app_guest_cart() TO duoshop_app;

CREATE POLICY guest_scope ON "Cart"
  USING ("guestTokenHash" IS NOT NULL AND "guestTokenHash" = app_guest_cart());
CREATE POLICY guest_scope ON "CartItem" USING (
  EXISTS (SELECT 1 FROM "Cart" c WHERE c."id" = "cartId"
           AND c."guestTokenHash" IS NOT NULL AND c."guestTokenHash" = app_guest_cart()));
-- Fusion à la connexion : le panier visiteur vidé est supprimé.
GRANT DELETE ON "Cart" TO duoshop_app;

-- Paniers visiteurs abandonnés : supprimés après 30 jours sans modification (worker).
CREATE FUNCTION purge_stale_guest_carts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_count integer;
BEGIN
  DELETE FROM "Cart" WHERE "guestTokenHash" IS NOT NULL AND "updatedAt" < now() - interval '30 days';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION purge_stale_guest_carts() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purge_stale_guest_carts() TO duoshop_app;
