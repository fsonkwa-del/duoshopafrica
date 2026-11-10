-- Retour arrière du lot 8 (base) : métriques et battements ne sont pas des données métier ; les
-- dates d'envoi des e-mails disparaissent (refusé si des e-mails ont été envoyés).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Notification" WHERE "emailedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'down refused: notifications were emailed';
  END IF;
END
$$;
DROP FUNCTION ops_metrics();
ALTER TABLE "Notification" DROP COLUMN "emailedAt";
DROP TABLE "WorkerHeartbeat";
