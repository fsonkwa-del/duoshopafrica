import { createDatabase } from "./client";
import { issueSessionToken } from "./session";

// DEV UNIQUEMENT : remplace la connexion OIDC tant que le fournisseur d'identité n'est pas choisi.
if (process.env.NODE_ENV === "production")
  throw new Error("Dev sessions are forbidden in production");
const [email, slug = "demo-douala", role = "OWNER"] = process.argv.slice(2);
if (!email?.endsWith("@example.invalid"))
  throw new Error(
    "Usage: dev:session <name@example.invalid> [storeSlug] [role]",
  );
if (!["OWNER", "MANAGER", "CATALOG", "FULFILLMENT"].includes(role))
  throw new Error("Unknown store role");
const db = createDatabase();
// --buyer : simple acheteur, sans aucune adhésion à une boutique.
if (slug === "--buyer") {
  try {
    const { token, tokenHash } = issueSessionToken();
    const user = await db.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });
    await db.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 12 * 3600_000),
      },
    });
    console.info(`DEV buyer session (12 h) for ${email}`);
    console.info(`Token: ${token}`);
  } finally {
    await db.$disconnect();
  }
  process.exit(0);
}
try {
  const { token, tokenHash } = issueSessionToken();
  const store = await db.$transaction(async (tx) => {
    const store = await tx.store.findUniqueOrThrow({ where: { slug } });
    if (!store.isDemo)
      throw new Error("Dev sessions only attach to DEMO stores");
    const user = await tx.user.upsert({
      where: { email },
      create: { email },
      update: {},
    });
    await tx.storeMember.upsert({
      where: {
        tenantId_storeId_userId: {
          tenantId: store.tenantId,
          storeId: store.id,
          userId: user.id,
        },
      },
      create: {
        tenantId: store.tenantId,
        storeId: store.id,
        userId: user.id,
        role: role as "OWNER",
      },
      update: { role: role as "OWNER", active: true },
    });
    await tx.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + 12 * 3600_000),
      },
    });
    return store;
  });
  console.info(
    `DEV session (12 h) for ${email} on ${store.slug} (${store.id})`,
  );
  console.info(
    `Open: http://localhost:3000/dev-login?token=${token}&store=${store.id}`,
  );
} finally {
  await db.$disconnect();
}
