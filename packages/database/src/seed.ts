import { createDatabase } from "./client";

if (process.env.NODE_ENV === "production")
  throw new Error("Demo seed is forbidden in production");
const db = createDatabase();
try {
  await db.$transaction(async (tx) => {
    await tx.currency.upsert({
      where: { code: "XAF" },
      create: { code: "XAF", minorUnits: 0 },
      update: {},
    });
    await tx.country.upsert({
      where: { code: "CM" },
      create: { code: "CM", name: "Cameroun", enabled: false },
      update: {},
    });
    for (const code of ["fr", "en"])
      await tx.locale.upsert({ where: { code }, create: { code }, update: {} });
    await tx.tenant.upsert({
      where: { id: "00000000-0000-4000-8000-000000000001" },
      create: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "DEMO — Douala",
        stores: {
          create: {
            slug: "demo-douala",
            name: "DEMO — Boutique sans transactions",
            isDemo: true,
          },
        },
      },
      update: {},
    });
  });
  console.info(
    "DEMO seed complete; no credentials, no active seller, no payment.",
  );
} finally {
  await db.$disconnect();
}
