-- Lot 1 (ADR 0009, faible débit) : vignette de chaque photo (480 px) pour les grilles ; les
-- photos plus anciennes, sans vignette, gardent leur image complète.
ALTER TABLE "ProductMedia" ADD COLUMN "thumbKey" TEXT;
