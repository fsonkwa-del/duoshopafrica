-- Ouverture d'une boutique par un utilisateur connecté : organisation EN ATTENTE, boutique,
-- rôle OWNER, emplacement de stock et audit, en une transaction. Rien n'est public ni vendable
-- avant l'approbation d'un ADMIN (vérification marchande existante).
CREATE FUNCTION open_store(p_name text, p_slug text, p_request text)
RETURNS TABLE (outcome text, store_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := app_user_id();
  v_name text := btrim(p_name);
  v_tenant uuid := gen_random_uuid();
  v_store uuid := gen_random_uuid();
BEGIN
  IF v_user IS NULL THEN
    RETURN QUERY SELECT 'unauthenticated'::text, NULL::uuid; RETURN;
  END IF;
  -- Adresse : minuscules, chiffres, tirets internes ; le préfixe demo est réservé.
  IF length(v_name) NOT BETWEEN 2 AND 80
     OR p_slug !~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$' OR p_slug ~ '--' OR p_slug LIKE 'demo%' THEN
    RETURN QUERY SELECT 'invalid'::text, NULL::uuid; RETURN;
  END IF;
  -- Anti-abus : au plus 3 boutiques en attente d'approbation par personne.
  PERFORM pg_advisory_xact_lock(hashtextextended('open_store:' || v_user::text, 0));
  IF (SELECT count(*) FROM "StoreMember" m JOIN "Tenant" t ON t."id" = m."tenantId"
       WHERE m."userId" = v_user AND m."role" = 'OWNER' AND t."status" = 'PENDING') >= 3 THEN
    RETURN QUERY SELECT 'too_many_pending'::text, NULL::uuid; RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM "Store" WHERE "slug" = p_slug) THEN
    RETURN QUERY SELECT 'slug_taken'::text, NULL::uuid; RETURN;
  END IF;
  BEGIN
    INSERT INTO "Tenant" ("id", "name", "status") VALUES (v_tenant, v_name, 'PENDING');
    INSERT INTO "Store" ("id", "tenantId", "slug", "name") VALUES (v_store, v_tenant, p_slug, v_name);
  EXCEPTION WHEN unique_violation THEN
    -- Même adresse demandée au même instant par quelqu'un d'autre.
    RETURN QUERY SELECT 'slug_taken'::text, NULL::uuid; RETURN;
  END;
  INSERT INTO "StoreMember" ("id", "tenantId", "storeId", "userId", "role")
  VALUES (gen_random_uuid(), v_tenant, v_store, v_user, 'OWNER');
  INSERT INTO "InventoryLocation" ("id", "tenantId", "storeId", "name")
  VALUES (gen_random_uuid(), v_tenant, v_store, 'Principal');
  INSERT INTO "AuditLog" ("id", "tenantId", "actorId", "action", "resourceId", "requestId", "detail")
  VALUES (gen_random_uuid(), v_tenant, v_user::text, 'store.open', v_store::text, p_request,
          jsonb_build_object('slug', p_slug));
  RETURN QUERY SELECT 'created'::text, v_store;
END
$$;
REVOKE ALL ON FUNCTION open_store(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION open_store(text, text, text) TO duoshop_app;
