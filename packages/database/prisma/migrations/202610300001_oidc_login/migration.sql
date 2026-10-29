-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "mfa" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "LoginAttempt" (
    "id" UUID NOT NULL,
    "stateHash" CHAR(64) NOT NULL,
    "nonce" TEXT NOT NULL,
    "codeVerifier" TEXT NOT NULL,
    "returnTo" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LoginAttempt_stateHash_key" ON "LoginAttempt"("stateHash");

-- CreateIndex
CREATE INDEX "LoginAttempt_expiresAt_idx" ON "LoginAttempt"("expiresAt");

-- Runtime : tentative consommable une seule fois, activité de session mise à jour, rien d'autre.
GRANT SELECT, INSERT ON "LoginAttempt" TO duoshop_app;
GRANT UPDATE ("consumedAt") ON "LoginAttempt" TO duoshop_app;
GRANT UPDATE ("lastSeenAt") ON "Session" TO duoshop_app;

-- Seul chemin de création/liaison de compte. SECURITY DEFINER car le runtime ne lit jamais
-- d'autres utilisateurs (RLS). L'API n'appelle cette fonction qu'avec email_verified = true
-- et un issuer configuré ; une identité déjà liée n'est jamais réaffectée.
CREATE FUNCTION auth_link_identity(p_issuer text, p_subject text, p_email text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(btrim(p_email));
  v_user uuid;
BEGIN
  IF coalesce(p_issuer, '') = '' OR coalesce(p_subject, '') = '' OR v_email !~ '^[^@\s]+@[^@\s]+$' THEN
    RAISE EXCEPTION 'invalid identity claims' USING ERRCODE = '22023';
  END IF;
  SELECT "userId" INTO v_user FROM "Identity" WHERE "issuer" = p_issuer AND "subject" = p_subject;
  IF FOUND THEN
    RETURN v_user;
  END IF;
  SELECT "id" INTO v_user FROM "User" WHERE lower("email") = v_email;
  IF NOT FOUND THEN
    INSERT INTO "User" ("id", "email") VALUES (gen_random_uuid(), v_email)
      ON CONFLICT ("email") DO NOTHING;
    SELECT "id" INTO v_user FROM "User" WHERE lower("email") = v_email;
  END IF;
  INSERT INTO "Identity" ("id", "userId", "issuer", "subject")
    VALUES (gen_random_uuid(), v_user, p_issuer, p_subject)
    ON CONFLICT ("issuer", "subject") DO NOTHING;
  SELECT "userId" INTO v_user FROM "Identity" WHERE "issuer" = p_issuer AND "subject" = p_subject;
  RETURN v_user;
END
$$;
REVOKE ALL ON FUNCTION auth_link_identity(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth_link_identity(text, text, text) TO duoshop_app;
