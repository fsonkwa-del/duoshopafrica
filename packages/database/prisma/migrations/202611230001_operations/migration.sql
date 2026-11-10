-- Lot 8 (ADR 0016) : battement des tâches du worker et métriques d'exploitation pour la
-- supervision (paiements en attente, écarts, files). Aucune donnée personnelle exposée.
CREATE TABLE "WorkerHeartbeat" (
    "job" TEXT NOT NULL,
    "lastRunAt" TIMESTAMPTZ(3) NOT NULL,
    "lastStatus" TEXT NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("job")
);

ALTER TABLE "Notification" ADD COLUMN "emailedAt" TIMESTAMPTZ(3);


-- ---------- Écrit à la main ----------
ALTER TABLE "WorkerHeartbeat" ADD CONSTRAINT "WorkerHeartbeat_values_valid" CHECK (
  "job" ~ '^[a-z_]{2,60}$' AND "lastStatus" IN ('ok', 'failed'));
ALTER TABLE "WorkerHeartbeat" ENABLE ROW LEVEL SECURITY;

-- Compteurs pour Prometheus : lus par l'API (jeton de supervision), sans contexte utilisateur.
CREATE FUNCTION ops_metrics() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'payments_pending_over_1h', (SELECT count(*) FROM "Payment"
                                  WHERE "status" = 'PENDING' AND "createdAt" < now() - interval '1 hour'),
    'payments_attention', (SELECT count(*) FROM "Payment"
                            WHERE "status" = 'SUCCEEDED' AND "attentionReason" IS NOT NULL),
    'provider_events_quarantined_24h', (SELECT count(*) FROM "ProviderEvent"
                                         WHERE "outcome" = 'QUARANTINED' AND "receivedAt" > now() - interval '24 hours'),
    'unbalanced_journals', (SELECT count(*) FROM (
                              SELECT j."id" FROM "LedgerJournal" j JOIN "LedgerEntry" e ON e."journalId" = j."id"
                               GROUP BY j."id" HAVING sum(e."amountMinor") <> 0) u),
    'media_pending', (SELECT count(*) FROM "ProductMedia" WHERE "status" = 'PENDING'),
    'kyc_pending', (SELECT count(*) FROM "KycProfile" WHERE "status" = 'SUBMITTED'),
    'data_requests_overdue', (SELECT count(*) FROM "DataRequest"
                               WHERE "closedAt" IS NULL AND "dueAt" < now()),
    'invoices_overdue', (SELECT count(*) FROM "CommissionInvoice"
                          WHERE "kind" = 'INVOICE' AND "paidAt" IS NULL AND "dueAt" < now()),
    'worker_heartbeats', coalesce((SELECT jsonb_object_agg("job", jsonb_build_object(
                            'age_seconds', extract(epoch FROM now() - "lastRunAt")::bigint,
                            'failed', "lastStatus" = 'failed'))
                          FROM "WorkerHeartbeat"), '{}'::jsonb))
$$;
REVOKE ALL ON FUNCTION ops_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops_metrics() TO duoshop_app;
