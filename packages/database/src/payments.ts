import { createHash } from "node:crypto";
import { asRuntime, type Database } from "./scope";

// Événement de paiement déjà vérifié par l'adaptateur du prestataire (signature ou statut relu).
export interface PaymentEventInput {
  eventId: string;
  paymentId: string;
  providerReference: string;
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  amountMinor: bigint;
  currency: string;
  occurredAt: Date;
  failureCode: string | null;
  payload: unknown;
  fingerprint?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Point d'application unique (webhook de l'API et rapprochement du worker) : persistance de
// l'événement et effet dans une seule transaction, dédoublonnés par apply_payment_event.
export async function applyPaymentEvent(
  db: Database,
  provider: string,
  event: PaymentEventInput,
  rawBody?: Buffer,
  // Compte marchand dont les identifiants ont vérifié l'événement (mode direct, lot 3).
  accountId: string | null = null,
): Promise<string | undefined> {
  const payloadHash =
    event.fingerprint ??
    createHash("sha256")
      .update(rawBody ?? JSON.stringify(event.payload))
      .digest("hex");
  const paymentId = UUID.test(event.paymentId) ? event.paymentId : null;
  const [row] = await asRuntime(
    db,
    {},
    (tx) =>
      tx.$queryRaw<{ outcome: string }[]>`
      SELECT apply_payment_event(${provider}, ${event.eventId}, ${payloadHash},
        ${JSON.stringify(event.payload)}::jsonb, ${paymentId}::uuid, ${event.providerReference},
        ${event.status}, ${event.amountMinor}, ${event.currency}, ${event.occurredAt},
        ${event.failureCode}, ${accountId}::uuid) AS outcome`,
  );
  return row?.outcome;
}

export function pendingProviderPayments(
  db: Database,
  provider: string,
  includeOld: boolean,
  limit = 20,
): Promise<
  { id: string; providerReference: string; storeAccountId: string | null }[]
> {
  return asRuntime(
    db,
    {},
    (tx) =>
      tx.$queryRaw<
        {
          id: string;
          providerReference: string;
          storeAccountId: string | null;
        }[]
      >`
      SELECT * FROM pending_provider_payments(${provider}, ${includeOld}, ${limit}::integer)`,
  );
}
