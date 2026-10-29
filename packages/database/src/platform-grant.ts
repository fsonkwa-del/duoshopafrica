import { userInfo } from "node:os";
import { createDatabase } from "./client";

// Exploitation : attribue ou retire un rôle plateforme à un compte déjà connecté une fois (OIDC).
// Opération privilégiée (connexion propriétaire) : à exécuter par une personne habilitée et à tracer
// dans le registre d'exploitation tant qu'un audit plateforme dédié n'existe pas.
const [email, role] = process.argv.slice(2);
if (!email || !["ADMIN", "SUPPORT", "FINANCE", "REVOKE"].includes(role ?? ""))
  throw new Error(
    "Usage: platform:grant <email> <ADMIN|SUPPORT|FINANCE|REVOKE>",
  );
const db = createDatabase();
try {
  const user = await db.user.findFirst({
    where: { email: { equals: email.trim(), mode: "insensitive" } },
  });
  if (!user)
    throw new Error(
      "Unknown user: sign in once through the identity provider first",
    );
  // Opération et audit dans la même transaction ; l'opérateur est l'utilisateur système qui l'exécute.
  const operator = process.env.DUOSHOP_OPERATOR ?? userInfo().username;
  await db.$transaction(async (tx) => {
    const before = await tx.platformMember.findUnique({
      where: { userId: user.id },
    });
    if (role === "REVOKE")
      await tx.platformMember.updateMany({
        where: { userId: user.id },
        data: { active: false },
      });
    else
      await tx.platformMember.upsert({
        where: { userId: user.id },
        create: { userId: user.id, role: role as "ADMIN" },
        update: { role: role as "ADMIN", active: true },
      });
    await tx.platformAudit.create({
      data: {
        operator,
        action: role === "REVOKE" ? "platform.revoke" : "platform.grant",
        targetUserId: user.id,
        detail: {
          from: before?.active ? before.role : null,
          to: role === "REVOKE" ? null : role,
        },
      },
    });
  });
  console.info(
    role === "REVOKE"
      ? `Platform role revoked for ${user.email} (by ${operator})`
      : `${user.email} is now ${role} (by ${operator}); MFA is required on every staff route.`,
  );
} finally {
  await db.$disconnect();
}
