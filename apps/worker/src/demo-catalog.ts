import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createDatabase } from "@duoshop/database";
import { makeThumbnail, processImage } from "@duoshop/media";

// DÉVELOPPEMENT UNIQUEMENT : charge un catalogue de démonstration (boutiques DEMO, produits,
// variantes, stock, photos libres de droits) depuis un manifeste produit par la collecte
// Wikimedia Commons. Les images passent par le même traitement que les envois vendeurs
// (vérification du format, ré-encodage WebP, métadonnées retirées) et sont servies par le site
// depuis apps/web/public/demo-media (MEDIA_PUBLIC_BASE_URL = origine du site).
// Usage : tsx src/demo-catalog.ts <dossier contenant manifest.json et raw/>
if (process.env.NODE_ENV === "production")
  throw new Error("The demo catalogue is forbidden in production");
const source = resolve(process.argv[2] ?? "");
const manifest = JSON.parse(
  readFileSync(join(source, "manifest.json"), "utf8"),
) as {
  products: {
    store: string;
    storeName: string;
    category: string;
    title: string;
    description: string;
    variants: { label: string; price: number; stock: number }[];
    image: {
      file: string;
      title: string;
      artist: string;
      license: string;
      licenseUrl: string;
      source: string;
    } | null;
  }[];
};
const TENANT_PREFIX = "DEMO-CATALOGUE";
const mediaDir = resolve("../web/public/demo-media");
mkdirSync(mediaDir, { recursive: true });
const pickup: Record<string, string> = {
  mode: "Marché Mboppi, allée 4",
  epicerie: "Marché de Bonabéri, face à la pharmacie",
  artisans: "Village artisanal, Akwa",
  beaute: "Boulevard de la Liberté, Akwa",
  phones: "Marché central, rayon téléphonie",
};

const db = createDatabase();
try {
  // Remplacement idempotent : seulement les tenants du catalogue de démonstration, et jamais
  // si des commandes y font référence (on ne détruit pas un historique de test).
  const old = await db.tenant.findMany({
    where: { name: { startsWith: TENANT_PREFIX } },
    select: { id: true },
  });
  const tenantId = { in: old.map((t) => t.id) };
  if (old.length) {
    if (await db.orderItem.count({ where: { tenantId } }))
      throw new Error(
        "Demo catalogue has orders: reset the demo orders before reloading",
      );
    await db.cartItem.deleteMany({ where: { variant: { tenantId } } });
    await db.productMedia.deleteMany({ where: { tenantId } });
    await db.stockLevel.deleteMany({ where: { tenantId } });
    await db.productVariant.deleteMany({ where: { tenantId } });
    await db.product.deleteMany({ where: { tenantId } });
    await db.inventoryLocation.deleteMany({ where: { tenantId } });
    await db.storeMember.deleteMany({ where: { tenantId } });
    await db.auditLog.deleteMany({ where: { tenantId } });
    await db.store.deleteMany({ where: { tenantId } });
    await db.tenant.deleteMany({ where: { id: tenantId } });
  }
  const categories = new Map(
    (await db.category.findMany({ select: { id: true, slug: true } })).map(
      (c) => [c.slug, c.id],
    ),
  );
  const stores = new Map<
    string,
    { tenantId: string; storeId: string; locationId: string }
  >();
  for (const p of manifest.products) {
    if (stores.has(p.store)) continue;
    const tenant = await db.tenant.create({
      data: { name: `${TENANT_PREFIX} ${p.storeName}`, status: "ACTIVE" },
    });
    const store = await db.store.create({
      data: {
        tenantId: tenant.id,
        slug: `demo-${p.store}`,
        name: p.storeName,
        isDemo: true,
        deliveryFeeMinor: p.store === "phones" ? 2000n : 1500n,
        pickupEnabled: true,
        pickupInstructions: pickup[p.store] ?? null,
      },
    });
    const location = await db.inventoryLocation.create({
      data: { tenantId: tenant.id, storeId: store.id, name: "Principal" },
    });
    stores.set(p.store, {
      tenantId: tenant.id,
      storeId: store.id,
      locationId: location.id,
    });
  }
  const credits = [];
  let images = 0;
  for (const [index, p] of manifest.products.entries()) {
    const s = stores.get(p.store);
    if (!s) continue;
    const product = await db.product.create({
      data: {
        tenantId: s.tenantId,
        storeId: s.storeId,
        title: p.title,
        description: p.description,
        status: "PUBLISHED",
        // Dates étalées : ordre « nouveautés » varié.
        publishedAt: new Date(Date.now() - index * 3_600_000),
        categoryId: categories.get(p.category) ?? null,
      },
    });
    for (const [i, v] of p.variants.entries()) {
      const variant = await db.productVariant.create({
        data: {
          tenantId: s.tenantId,
          productId: product.id,
          sku: `DEMO-${String(index).padStart(2, "0")}-${i}`,
          label: v.label,
          priceMinor: BigInt(v.price),
          currency: "XAF",
        },
      });
      await db.stockLevel.create({
        data: {
          tenantId: s.tenantId,
          variantId: variant.id,
          locationId: s.locationId,
          onHand: v.stock,
        },
      });
    }
    if (!p.image) continue;
    const outcome = await processImage(
      readFileSync(join(source, "raw", p.image.file)),
    );
    if (!outcome.ok) {
      console.warn(`image refusée (${outcome.reason}) : ${p.title}`);
      continue;
    }
    const file = `${String(index).padStart(2, "0")}-${randomUUID().slice(0, 8)}.webp`;
    writeFileSync(join(mediaDir, file), outcome.data);
    const thumb = file.replace(/\.webp$/, "-480.webp");
    writeFileSync(join(mediaDir, thumb), await makeThumbnail(outcome.data));
    await db.productMedia.create({
      data: {
        tenantId: s.tenantId,
        productId: product.id,
        status: "READY",
        uploadKey: `demo/${randomUUID()}`,
        publicKey: `demo-media/${file}`,
        thumbKey: `demo-media/${thumb}`,
        altFr: p.title,
        altEn: p.title,
        width: outcome.width,
        height: outcome.height,
        bytes: outcome.data.byteLength,
        processedAt: new Date(),
      },
    });
    images++;
    const { file: _file, ...credit } = p.image;
    credits.push({ product: p.title, ...credit });
  }
  writeFileSync(
    join(mediaDir, "credits.json"),
    JSON.stringify(credits, null, 1),
  );
  console.info(
    `catalogue de démonstration : ${stores.size} boutiques, ${manifest.products.length} produits, ${images} photos`,
  );
} finally {
  await db.$disconnect();
}
