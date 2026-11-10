-- Lot 2 (ADR 0010) : rôle plateforme COMPLIANCE (données personnelles, pièces KYC, journal des
-- consultations). Migration séparée : une nouvelle valeur d'enum ne s'utilise qu'après validation.
ALTER TYPE "PlatformRole" ADD VALUE IF NOT EXISTS 'COMPLIANCE';
