-- Les valeurs ajoutées à LedgerAccount restent (PostgreSQL ne les retire pas) : refusé si une
-- écriture les utilise. Le type CollectionMode disparaît.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "LedgerEntry"
              WHERE "account"::text IN ('COMMISSION_RECEIVABLE', 'PSP_FEES', 'VAT_COLLECTED')) THEN
    RAISE EXCEPTION 'down refused: ledger entries use the new accounts';
  END IF;
  IF EXISTS (SELECT 1 FROM "Refund" WHERE "status"::text = 'SELLER_TO_EXECUTE') THEN
    RAISE EXCEPTION 'down refused: refunds await execution by sellers';
  END IF;
END
$$;
DROP TYPE "CollectionMode";
