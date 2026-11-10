-- PostgreSQL ne retire pas une valeur d'enum : la valeur reste, sans effet si personne ne la porte.
-- Refusé si un membre a encore ce rôle (il faut d'abord le révoquer).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "PlatformMember" WHERE "role"::text = 'COMPLIANCE') THEN
    RAISE EXCEPTION 'down refused: a platform member still holds the COMPLIANCE role';
  END IF;
END
$$;
