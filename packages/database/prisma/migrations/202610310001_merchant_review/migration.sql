-- CreateEnum
CREATE TYPE "PlatformRole" AS ENUM ('ADMIN', 'SUPPORT');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "detail" JSONB;

-- AlterTable : conversion en place (pas de DROP COLUMN, aucune donnée perdue).
ALTER TABLE "MerchantVerification" ADD COLUMN     "decisionReason" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "reviewedBy" UUID,
ADD COLUMN     "submittedAt" TIMESTAMPTZ(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "VerificationStatus" USING "status"::"VerificationStatus",
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "PlatformMember" (
    "userId" UUID NOT NULL,
    "role" "PlatformRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformMember_pkey" PRIMARY KEY ("userId")
);

-- AddForeignKey
ALTER TABLE "PlatformMember" ADD CONSTRAINT "PlatformMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rôle plateforme de l'utilisateur du contexte. Le runtime n'a aucun droit direct sur PlatformMember :
-- l'attribution reste une opération d'exploitation (pnpm platform:grant).
CREATE FUNCTION app_platform_role() RETURNS "PlatformRole"
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
  $$ SELECT "role" FROM "PlatformMember" WHERE "userId" = app_user_id() AND "active" $$;
REVOKE ALL ON FUNCTION app_platform_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_platform_role() TO duoshop_app;

-- Lecture inter-tenant réservée au personnel plateforme réel. Les écritures restent bornées
-- au tenant explicitement entré (politiques tenant_scope existantes).
CREATE POLICY staff_read ON "Tenant" FOR SELECT USING (app_platform_role() IS NOT NULL);
CREATE POLICY staff_read ON "Store" FOR SELECT USING (app_platform_role() IS NOT NULL);
CREATE POLICY staff_read ON "MerchantVerification" FOR SELECT USING (app_platform_role() IS NOT NULL);
CREATE POLICY staff_read ON "AuditLog" FOR SELECT USING (app_platform_role() IS NOT NULL);

GRANT INSERT ON "MerchantVerification" TO duoshop_app;
GRANT UPDATE ("status", "legalName", "registrationNumber", "submittedAt", "decisionReason",
  "reviewedBy", "reviewedAt", "version") ON "MerchantVerification" TO duoshop_app;
GRANT UPDATE ("status", "version") ON "Tenant" TO duoshop_app;
-- Purge des tentatives de connexion expirées par le worker.
GRANT DELETE ON "LoginAttempt" TO duoshop_app;
