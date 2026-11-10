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

// Conservation (lot 2, ADR 0010) : durées et mode lus dans les paramètres datés. En DRY_RUN, la
// passe compte sans rien modifier. Connexion propriétaire : la fonction n'est pas ouverte au runtime.
export async function applyRetention(
  db: Database,
): Promise<{ mode: string; rules: { rule: string; affected: number }[] }> {
  const [setting] = await db.$queryRaw<{ mode: string }[]>`
    SELECT param_value('retention.mode') AS mode`;
  const mode = setting?.mode === "ENFORCE" ? "ENFORCE" : "DRY_RUN";
  const rules = await db.$queryRaw<{ rule: string; affected: number }[]>`
    SELECT rule, affected FROM apply_retention(${mode === "ENFORCE"})`;
  return { mode, rules };
}
