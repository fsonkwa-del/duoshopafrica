-- Lot 3 (ADR 0011) : modes d'encaissement, comptes de journal du mode direct et de la fiscalité
-- (lot 4). Migration séparée : une nouvelle valeur d'enum ne s'utilise qu'après validation.
CREATE TYPE "CollectionMode" AS ENUM ('PLATFORM_HELD', 'DIRECT_SELLER', 'PSP_ESCROW');
ALTER TYPE "LedgerAccount" ADD VALUE IF NOT EXISTS 'COMMISSION_RECEIVABLE';
ALTER TYPE "LedgerAccount" ADD VALUE IF NOT EXISTS 'PSP_FEES';
ALTER TYPE "LedgerAccount" ADD VALUE IF NOT EXISTS 'VAT_COLLECTED';
-- Mode direct : le remboursement décidé est exécuté par le vendeur, pas par la plateforme.
ALTER TYPE "RefundStatus" ADD VALUE IF NOT EXISTS 'SELLER_TO_EXECUTE';
