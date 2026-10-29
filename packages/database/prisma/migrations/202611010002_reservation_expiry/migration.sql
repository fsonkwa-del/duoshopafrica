-- Libération des réservations expirées, tous tenants confondus, pour le worker uniquement.
-- SECURITY DEFINER car la RLS borne le runtime à un tenant ; périmètre volontairement étroit :
-- seules des réservations ACTIVE et expirées sont libérées, par lots, sans attendre les verrous.
CREATE FUNCTION release_expired_reservations(p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE "StockReservation" r
       SET "status" = 'RELEASED', "releasedAt" = now()
     WHERE r."id" IN (
       SELECT "id" FROM "StockReservation"
        WHERE "status" = 'ACTIVE' AND "expiresAt" < now()
        ORDER BY "expiresAt"
        LIMIT greatest(p_limit, 0)
        FOR UPDATE SKIP LOCKED)
    RETURNING r."variantId", r."locationId", r."quantity"
  ), totals AS (
    SELECT "variantId", "locationId", sum("quantity")::integer AS quantity
      FROM expired GROUP BY "variantId", "locationId"
  ), restock AS (
    UPDATE "StockLevel" s
       SET "reserved" = s."reserved" - t.quantity, "updatedAt" = now()
      FROM totals t
     WHERE s."variantId" = t."variantId" AND s."locationId" = t."locationId"
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN v_count;
END
$$;
REVOKE ALL ON FUNCTION release_expired_reservations(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION release_expired_reservations(integer) TO duoshop_app;
