-- Rapprochement par le worker, tous acheteurs confondus : paiements dont la référence prestataire
-- est connue et dont le prestataire n'a encore rapporté aucun statut final, pour relire leur statut
-- quand la notification s'est perdue (Fapshi ne renvoie jamais un webhook). Inclut les tentatives
-- closes localement (EXPIRED : délai de 10 minutes ou commande expirée), car le lien Fapshi reste
-- payable 24 heures : un paiement tardif doit être vu (apply_payment_event le signale).
-- Les plus récentes (moins de 30 minutes) à chaque passage ; les plus anciennes (jusqu'à 25 heures)
-- seulement quand p_include_old est vrai. Périmètre étroit : identifiant et référence seulement.
CREATE FUNCTION pending_provider_payments(p_provider text, p_include_old boolean, p_limit integer)
RETURNS TABLE ("id" uuid, "providerReference" text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p."id", p."providerReference"
    FROM "Payment" p
   WHERE p."provider" = p_provider
     AND p."status" IN ('PENDING', 'EXPIRED')
     AND p."providerReference" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM "ProviderEvent" e
                      WHERE e."paymentId" = p."id" AND e."reportedStatus" IN ('SUCCEEDED', 'FAILED'))
     AND p."createdAt" < now() - interval '1 minute'
     AND p."createdAt" > now() - CASE WHEN p_include_old THEN interval '25 hours'
                                      ELSE interval '30 minutes' END
   ORDER BY p."createdAt"
   LIMIT least(greatest(p_limit, 0), 100)
$$;
REVOKE ALL ON FUNCTION pending_provider_payments(text, boolean, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pending_provider_payments(text, boolean, integer) TO duoshop_app;
