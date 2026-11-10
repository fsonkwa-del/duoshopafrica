-- Lot 7 (ADR 0015) : « arbitrage » devient « médiation ». Comportement inchangé.
-- L'ancien nom reste un alias pendant un lot (clients déjà déployés), puis sera supprimé.
ALTER FUNCTION arbitrate_claim(uuid, boolean, text) RENAME TO mediate_claim;

CREATE FUNCTION arbitrate_claim(p_claim uuid, p_refund boolean, p_note text)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS
  $$ SELECT mediate_claim(p_claim, p_refund, p_note) $$;
REVOKE ALL ON FUNCTION arbitrate_claim(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arbitrate_claim(uuid, boolean, text) TO duoshop_app;
