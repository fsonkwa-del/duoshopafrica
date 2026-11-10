import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDatabase } from "@duoshop/database";
import { makeThumbnail } from "@duoshop/media";

// Développement : vignettes manquantes des photos du catalogue de démonstration (lot 1, faible
// débit), sans recharger le catalogue ni toucher aux commandes existantes.
// Usage : tsx src/demo-thumbnails.ts
if (process.env.NODE_ENV === "production")
  throw new Error("The demo catalogue is forbidden in production");
const mediaDir = resolve("../web/public/demo-media");
const db = createDatabase();
try {
  const media = await db.productMedia.findMany({
    where: { thumbKey: null, publicKey: { startsWith: "demo-media/" } },
    select: { id: true, publicKey: true },
  });
  let done = 0;
  for (const m of media) {
    const file = (m.publicKey ?? "").slice("demo-media/".length);
    if (!file || !existsSync(join(mediaDir, file))) continue;
    const thumb = file.replace(/\.webp$/, "-480.webp");
    writeFileSync(
      join(mediaDir, thumb),
      await makeThumbnail(readFileSync(join(mediaDir, file))),
    );
    await db.productMedia.update({
      where: { id: m.id },
      data: { thumbKey: `demo-media/${thumb}` },
    });
    done++;
  }
  console.log(`thumbnails created: ${done}`);
} finally {
  await db.$disconnect();
}
