import { asRuntime, type Database, type ScopedTx } from "./scope";

// Toutes les fonctions reçoivent une transaction déjà entrée dans le tenant (enterTenant) :
// la RLS borne les lignes visibles, les UPDATE conditionnels portent l'invariant de stock.
// Aucune lecture-puis-écriture côté application : la condition est évaluée par PostgreSQL
// sous verrou de ligne, ce qui rend les opérations sûres sous concurrence.

export interface StockSnapshot {
  onHand: number;
  reserved: number;
}

export type AdjustOutcome =
  | ({ status: "applied" | "replayed" } & StockSnapshot)
  | { status: "insufficient" | "conflict" | "not_found" };

async function level(
  tx: ScopedTx,
  variantId: string,
  locationId: string,
): Promise<StockSnapshot | null> {
  return tx.stockLevel.findUnique({
    where: { variantId_locationId: { variantId, locationId } },
    select: { onHand: true, reserved: true },
  });
}

export async function adjustStock(
  tx: ScopedTx,
  input: {
    tenantId: string;
    variantId: string;
    locationId: string;
    delta: number;
    reason: "RECEIPT" | "ADJUSTMENT";
    note: string | null;
    actorId: string;
    idempotencyKey: string;
  },
): Promise<AdjustOutcome> {
  // Rejeu (double clic, retry réseau) : même clé et même demande => même résultat, sans effet.
  const previous = await tx.stockMovement.findUnique({
    where: {
      tenantId_idempotencyKey: {
        tenantId: input.tenantId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
  if (previous) {
    if (
      previous.variantId !== input.variantId ||
      previous.delta !== input.delta
    )
      return { status: "conflict" };
    const current = await level(tx, input.variantId, input.locationId);
    return current
      ? { status: "replayed", ...current }
      : { status: "not_found" };
  }
  const [updated] = await tx.$queryRaw<StockSnapshot[]>`
    UPDATE "StockLevel"
       SET "onHand" = "onHand" + ${input.delta}, "updatedAt" = now()
     WHERE "variantId" = ${input.variantId}::uuid
       AND "locationId" = ${input.locationId}::uuid
       AND "onHand" + ${input.delta} >= "reserved"
    RETURNING "onHand", "reserved"`;
  if (!updated)
    return (await level(tx, input.variantId, input.locationId))
      ? { status: "insufficient" }
      : { status: "not_found" };
  // Une clé rejouée en parallèle échoue ici (unicité) et annule toute la transaction.
  await tx.stockMovement.create({
    data: {
      tenantId: input.tenantId,
      variantId: input.variantId,
      locationId: input.locationId,
      delta: input.delta,
      reason: input.reason,
      note: input.note,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
    },
  });
  return { status: "applied", ...updated };
}

export type ReserveOutcome =
  | { status: "reserved" | "replayed"; reservationId: string }
  | { status: "insufficient" | "conflict" };

export async function reserveStock(
  tx: ScopedTx,
  input: {
    tenantId: string;
    variantId: string;
    locationId: string;
    quantity: number;
    reference: string;
    expiresAt: Date;
  },
): Promise<ReserveOutcome> {
  if (!Number.isInteger(input.quantity) || input.quantity <= 0)
    throw new RangeError("Reservation quantity must be a positive integer");
  const previous = await tx.stockReservation.findUnique({
    where: {
      tenantId_reference: {
        tenantId: input.tenantId,
        reference: input.reference,
      },
    },
  });
  if (previous)
    return previous.variantId === input.variantId &&
      previous.quantity === input.quantity
      ? { status: "replayed", reservationId: previous.id }
      : { status: "conflict" };
  const [updated] = await tx.$queryRaw<StockSnapshot[]>`
    UPDATE "StockLevel"
       SET "reserved" = "reserved" + ${input.quantity}, "updatedAt" = now()
     WHERE "variantId" = ${input.variantId}::uuid
       AND "locationId" = ${input.locationId}::uuid
       AND "onHand" - "reserved" >= ${input.quantity}
    RETURNING "onHand", "reserved"`;
  if (!updated) return { status: "insufficient" };
  const reservation = await tx.stockReservation.create({
    data: {
      tenantId: input.tenantId,
      variantId: input.variantId,
      locationId: input.locationId,
      quantity: input.quantity,
      reference: input.reference,
      expiresAt: input.expiresAt,
    },
  });
  return { status: "reserved", reservationId: reservation.id };
}

export async function releaseReservation(
  tx: ScopedTx,
  input: { tenantId: string; reference: string },
): Promise<boolean> {
  // Passage ACTIVE -> RELEASED une seule fois ; le perdant d'une course ne restitue rien.
  const [released] = await tx.$queryRaw<
    { variantId: string; locationId: string; quantity: number }[]
  >`
    UPDATE "StockReservation"
       SET "status" = 'RELEASED', "releasedAt" = now()
     WHERE "tenantId" = ${input.tenantId}::uuid
       AND "reference" = ${input.reference}
       AND "status" = 'ACTIVE'
    RETURNING "variantId", "locationId", "quantity"`;
  if (!released) return false;
  await tx.$executeRaw`
    UPDATE "StockLevel"
       SET "reserved" = "reserved" - ${released.quantity}, "updatedAt" = now()
     WHERE "variantId" = ${released.variantId}::uuid
       AND "locationId" = ${released.locationId}::uuid`;
  return true;
}

export async function releaseExpiredReservations(
  db: Database,
  batch = 500,
): Promise<number> {
  const [row] = await asRuntime(
    db,
    {},
    (tx) =>
      tx.$queryRaw<{ released: number }[]>`
      SELECT release_expired_reservations(${batch}::integer) AS released`,
  );
  return row?.released ?? 0;
}

// Commandes non payées dont la fenêtre de paiement est échue : statut EXPIRED, stock restitué.
export async function expireUnpaidOrders(
  db: Database,
  batch = 200,
): Promise<number> {
  const [row] = await asRuntime(
    db,
    {},
    (tx) =>
      tx.$queryRaw<{ expired: number }[]>`
      SELECT expire_unpaid_orders(${batch}::integer) AS expired`,
  );
  return row?.expired ?? 0;
}
