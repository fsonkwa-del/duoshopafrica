-- Traitement des photos par le worker, tous tenants confondus (ADR 0006). Périmètre étroit :
-- lister ce qui attend, puis finaliser UNE photo encore PENDING vers READY ou REJECTED.
CREATE FUNCTION pending_media(p_limit integer)
RETURNS TABLE ("id" uuid, "tenantId" uuid, "uploadKey" text, "createdAt" timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT m."id", m."tenantId", m."uploadKey", m."createdAt"
    FROM "ProductMedia" m
   WHERE m."status" = 'PENDING'
   ORDER BY m."createdAt"
   LIMIT greatest(p_limit, 0)
$$;

CREATE FUNCTION complete_media(
  p_id uuid, p_status "MediaStatus", p_public_key text,
  p_width integer, p_height integer, p_bytes integer, p_reason text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_status NOT IN ('READY', 'REJECTED') THEN
    RAISE EXCEPTION 'invalid media outcome' USING ERRCODE = '22023';
  END IF;
  IF p_status = 'READY' AND (p_public_key IS NULL OR p_width IS NULL OR p_height IS NULL) THEN
    RAISE EXCEPTION 'ready media needs a public key and dimensions' USING ERRCODE = '22023';
  END IF;
  UPDATE "ProductMedia"
     SET "status" = p_status,
         "publicKey" = CASE WHEN p_status = 'READY' THEN p_public_key END,
         "width" = p_width, "height" = p_height, "bytes" = p_bytes,
         "rejectReason" = CASE WHEN p_status = 'REJECTED' THEN p_reason END,
         "processedAt" = now()
   WHERE "id" = p_id AND "status" = 'PENDING';
  RETURN FOUND;
END
$$;
REVOKE ALL ON FUNCTION pending_media(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION complete_media(uuid, "MediaStatus", text, integer, integer, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_media(integer) TO duoshop_app;
GRANT EXECUTE ON FUNCTION complete_media(uuid, "MediaStatus", text, integer, integer, integer, text) TO duoshop_app;
