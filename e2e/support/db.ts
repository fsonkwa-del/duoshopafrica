import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

// Accès direct (superutilisateur local) pour préparer et nettoyer les données des tests E2E.
// La connexion réelle passe par Zitadel : les tests injectent une session comme le ferait le
// retour OIDC (même format de jeton, même empreinte en base).
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL missing (.env)");
  return line.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
}

export const pool = new pg.Pool({
  connectionString: databaseUrl(),
  max: 2,
  options: "-c TimeZone=UTC",
  allowExitOnIdle: true,
});

export const E2E_PREFIX = "e2e-";
export const E2E_METHOD = "E2E_MTN";
export const E2E_TENANT = "TEST-E2E";

export interface Seed {
  storeId: string;
  storeSlug: string;
  productId: string;
  productTitle: string;
  sellerToken: string;
  adminToken: string;
}

export async function session(
  email: string,
  options: { mfa?: boolean } = {},
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(token).digest("hex");
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "User" ("id", "email") VALUES (gen_random_uuid(), $1)
     ON CONFLICT ("email") DO UPDATE SET "email" = EXCLUDED."email" RETURNING "id"`,
    [email],
  );
  await pool.query(
    `INSERT INTO "Session" ("id", "userId", "tokenHash", "expiresAt", "mfa")
     VALUES (gen_random_uuid(), $1, $2, now() + interval '2 hours', $3)`,
    [rows[0]?.id, hash, options.mfa ?? false],
  );
  return token;
}

export async function seed(): Promise<Seed> {
  await cleanup();
  const suffix = randomBytes(3).toString("hex");
  const productTitle = `Tissu kente E2E ${suffix}`;
  const { rows } = await pool.query<{
    store_id: string;
    slug: string;
    product_id: string;
    tenant_id: string;
  }>(
    `WITH t AS (INSERT INTO "Tenant" ("id", "name", "status") VALUES (gen_random_uuid(), $1, 'ACTIVE') RETURNING "id"),
     s AS (INSERT INTO "Store" ("id", "tenantId", "slug", "name", "deliveryFeeMinor", "pickupEnabled", "pickupInstructions")
           SELECT gen_random_uuid(), t."id", $2, 'Boutique E2E', 1000, true, 'Marché Central, stand 7' FROM t
           RETURNING "id", "tenantId", "slug"),
     l AS (INSERT INTO "InventoryLocation" ("id", "tenantId", "storeId", "name")
           SELECT gen_random_uuid(), s."tenantId", s."id", 'Principal' FROM s RETURNING "id", "tenantId"),
     p AS (INSERT INTO "Product" ("id", "tenantId", "storeId", "title", "description", "status", "publishedAt", "updatedAt")
           SELECT gen_random_uuid(), s."tenantId", s."id", $3, 'Tissu tissé main, 2 mètres.', 'PUBLISHED', now(), now() FROM s
           RETURNING "id", "tenantId"),
     v AS (INSERT INTO "ProductVariant" ("id", "tenantId", "productId", "sku", "label", "priceMinor", "currency")
           SELECT gen_random_uuid(), p."tenantId", p."id", $4, '2 mètres', 5000, 'XAF' FROM p RETURNING "id", "tenantId")
     INSERT INTO "StockLevel" ("tenantId", "variantId", "locationId", "onHand")
     SELECT v."tenantId", v."id", l."id", 50 FROM v, l
     RETURNING (SELECT "id" FROM s) AS store_id, (SELECT "slug" FROM s) AS slug,
               (SELECT "id" FROM p) AS product_id, (SELECT "id" FROM t) AS tenant_id`,
    [E2E_TENANT, `e2e-${suffix}`, productTitle, `E2E-${suffix}`],
  );
  const row = rows[0];
  if (!row) throw new Error("seed failed");
  await pool.query(
    `INSERT INTO "PaymentMethod" ("id", "code", "kind", "operator", "provider", "countryCode", "currency",
       "labelFr", "labelEn", "phonePrefixes", "minAmountMinor", "displayOrder", "enabled")
     VALUES (gen_random_uuid(), $1, 'MOBILE_MONEY', 'MTN', 'mock', 'CM', 'XAF',
       'MTN Mobile Money (E2E)', 'MTN Mobile Money (E2E)', '{+23767,+23768}', 100, 0, true)`,
    [E2E_METHOD],
  );
  const sellerToken = await session(`${E2E_PREFIX}seller@example.invalid`);
  await pool.query(
    `INSERT INTO "StoreMember" ("id", "tenantId", "storeId", "userId", "role")
     SELECT gen_random_uuid(), $1, $2, u."id", 'OWNER' FROM "User" u WHERE u."email" = $3`,
    [row.tenant_id, row.store_id, `${E2E_PREFIX}seller@example.invalid`],
  );
  const adminToken = await session(`${E2E_PREFIX}admin@example.invalid`, {
    mfa: true,
  });
  await pool.query(
    `INSERT INTO "PlatformMember" ("userId", "role")
     SELECT "id", 'ADMIN' FROM "User" WHERE "email" = $1`,
    [`${E2E_PREFIX}admin@example.invalid`],
  );
  return {
    storeId: row.store_id,
    storeSlug: row.slug,
    productId: row.product_id,
    productTitle,
    sellerToken,
    adminToken,
  };
}

export async function handoverCode(orderId: string): Promise<string> {
  const { rows } = await pool.query<{ code: string }>(
    `SELECT h."code" FROM "HandoverCode" h JOIN "SellerOrder" so ON so."id" = h."sellerOrderId"
      WHERE so."orderId" = $1`,
    [orderId],
  );
  if (!rows[0]) throw new Error("no handover code");
  return rows[0].code;
}

// Suppression de tout ce que les tests ont créé (ordre imposé par les clés étrangères).
export async function cleanup(): Promise<void> {
  await pool.query(`
    DO $$
    DECLARE v_t uuid[]; v_u uuid[]; v_so uuid[]; v_o uuid[]; v_p uuid[]; v_r uuid[];
    BEGIN
      SELECT array_agg("id") INTO v_t FROM "Tenant" WHERE "name" = 'TEST-E2E';
      SELECT array_agg("id") INTO v_u FROM "User" WHERE "email" LIKE 'e2e-%@example.invalid';
      SELECT array_agg("id") INTO v_so FROM "SellerOrder" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      SELECT array_agg(DISTINCT "orderId") INTO v_o FROM "SellerOrder" WHERE "id" = ANY(coalesce(v_so, '{}'));
      SELECT array_agg("id") INTO v_p FROM "Payment" WHERE "orderId" = ANY(coalesce(v_o, '{}'))
        OR "methodCode" = 'E2E_MTN';
      SELECT array_agg("id") INTO v_r FROM "Refund" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "LedgerEntry" WHERE "journalId" IN (SELECT "id" FROM "LedgerJournal"
        WHERE "sourceId" = ANY(SELECT unnest(coalesce(v_so, '{}') || coalesce(v_p, '{}') || coalesce(v_r, '{}'))::text));
      DELETE FROM "LedgerJournal" WHERE "sourceId" = ANY(SELECT unnest(coalesce(v_so, '{}') || coalesce(v_p, '{}') || coalesce(v_r, '{}'))::text);
      DELETE FROM "Refund" WHERE "id" = ANY(coalesce(v_r, '{}'));
      DELETE FROM "ClaimEvent" WHERE "claimId" IN (SELECT "id" FROM "Claim" WHERE "tenantId" = ANY(coalesce(v_t, '{}')));
      DELETE FROM "ClaimItem" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "Claim" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "HandoverCode" WHERE "sellerOrderId" = ANY(coalesce(v_so, '{}'));
      DELETE FROM "FulfilmentEvent" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "OutboxEvent" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "ProviderEvent" WHERE "paymentId" = ANY(coalesce(v_p, '{}'));
      DELETE FROM "Payment" WHERE "id" = ANY(coalesce(v_p, '{}'));
      DELETE FROM "PaymentMethod" WHERE "code" = 'E2E_MTN';
      DELETE FROM "StockMovement" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "OrderItem" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "SellerOrder" WHERE "id" = ANY(coalesce(v_so, '{}'));
      DELETE FROM "Order" WHERE "id" = ANY(coalesce(v_o, '{}'));
      DELETE FROM "StockReservation" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "CartItem" WHERE "variantId" IN (SELECT "id" FROM "ProductVariant" WHERE "tenantId" = ANY(coalesce(v_t, '{}')));
      DELETE FROM "StockLevel" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "ProductVariant" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "Product" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "InventoryLocation" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "StoreMember" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "AuditLog" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "Store" WHERE "tenantId" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "Tenant" WHERE "id" = ANY(coalesce(v_t, '{}'));
      DELETE FROM "Notification" WHERE "userId" = ANY(coalesce(v_u, '{}'));
      DELETE FROM "Address" WHERE "userId" = ANY(coalesce(v_u, '{}'));
      DELETE FROM "Cart" WHERE "userId" = ANY(coalesce(v_u, '{}'));
      DELETE FROM "PlatformMember" WHERE "userId" = ANY(coalesce(v_u, '{}'));
      DELETE FROM "Session" WHERE "userId" = ANY(coalesce(v_u, '{}'));
      DELETE FROM "User" WHERE "id" = ANY(coalesce(v_u, '{}'));
    END $$;`);
}
