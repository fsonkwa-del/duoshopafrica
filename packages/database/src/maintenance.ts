import { asRuntime, type Database } from "./scope";

// Les tentatives expirées n'ont plus d'usage ; on garde 24 h pour l'analyse d'incident.
export async function purgeExpiredLoginAttempts(
  db: Database,
  now = new Date(),
  graceMs = 24 * 3600_000,
): Promise<number> {
  const { count } = await asRuntime(db, {}, (tx) =>
    tx.loginAttempt.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - graceMs) } },
    }),
  );
  return count;
}

// Paniers visiteurs sans modification depuis 30 jours (aucune donnée personnelle, mais inutiles).
export async function purgeStaleGuestCarts(db: Database): Promise<number> {
  const [row] = await asRuntime(
    db,
    {},
    (tx) =>
      tx.$queryRaw<
        { purged: number }[]
      >`SELECT purge_stale_guest_carts() AS purged`,
  );
  return row?.purged ?? 0;
}
