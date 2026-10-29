import type { PrismaClient } from "../generated/client";

export type Database = PrismaClient;
export type ScopedTx = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertUuid(value: string): void {
  if (!uuid.test(value)) throw new TypeError("Scope identifiers must be UUIDs");
}

// Toute lecture/écriture métier passe ici : rôle non-owner, RLS active, contexte local à la transaction.
// SET LOCAL et set_config(..., true) disparaissent au COMMIT : aucun contexte ne fuit vers le pool.
export async function asRuntime<T>(
  db: Database,
  // guestCart : empreinte SHA-256 (hex) du jeton de panier visiteur.
  context: { userId?: string; guestCart?: string },
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET LOCAL ROLE duoshop_app");
    if (context.userId) {
      assertUuid(context.userId);
      await tx.$queryRaw`SELECT set_config('app.user_id', ${context.userId}, true)`;
    }
    if (context.guestCart) {
      if (!/^[0-9a-f]{64}$/.test(context.guestCart))
        throw new TypeError("Guest cart scope must be a SHA-256 hex digest");
      await tx.$queryRaw`SELECT set_config('app.guest_cart', ${context.guestCart}, true)`;
    }
    return fn(tx);
  });
}

export async function enterTenant(
  tx: ScopedTx,
  tenantId: string,
): Promise<void> {
  assertUuid(tenantId);
  await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
}
