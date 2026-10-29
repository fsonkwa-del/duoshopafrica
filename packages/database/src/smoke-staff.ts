import { createDatabase } from "./client";
import { issueSessionToken } from "./session";

// DEV UNIQUEMENT : session de personnel plateforme pour un smoke d'interface local.
// mfa=true est posé ici ; l'attestation réelle par Zitadel est couverte par zitadel.smoke.ts.
if (process.env.NODE_ENV === "production")
  throw new Error("Smoke staff sessions are forbidden in production");
const [email, role = "ADMIN"] = process.argv.slice(2);
if (
  !email?.endsWith("@example.invalid") ||
  !["ADMIN", "SUPPORT"].includes(role)
)
  throw new Error("Usage: smoke-staff <name@example.invalid> [ADMIN|SUPPORT]");
const db = createDatabase();
try {
  const { token, tokenHash } = issueSessionToken();
  await db.$transaction(async (tx) => {
    const user = await tx.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });
    await tx.platformMember.upsert({
      where: { userId: user.id },
      create: { userId: user.id, role: role as "ADMIN" },
      update: { role: role as "ADMIN", active: true },
    });
    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash,
        mfa: true,
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
  });
  console.info(token);
} finally {
  await db.$disconnect();
}
