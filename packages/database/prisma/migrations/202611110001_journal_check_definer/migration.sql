-- Le contrôle différé d'équilibre du journal s'exécute à la validation de la transaction.
-- PostgreSQL 17 l'exécute avec le rôle courant à ce moment (duoshop_app, à qui la RLS cache
-- les lignes du journal : journal vu vide, paiement refusé) ; PostgreSQL 18 avec le rôle actif
-- lors de l'insertion. SECURITY DEFINER : même résultat sur les deux versions.
ALTER FUNCTION assert_journal_balanced() SECURITY DEFINER;
