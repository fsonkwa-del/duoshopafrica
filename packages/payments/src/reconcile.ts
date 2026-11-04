import type { VerifiedPaymentEvent } from "./provider";
import type { PaymentProviders } from "./registry";

// Accès base injecté (le paquet paiements ne dépend pas de la base) : liste des paiements en
// attente d'un prestataire, et application d'un événement vérifié (apply_payment_event).
export interface ReconcileStore {
  pending(
    provider: string,
    includeOld: boolean,
  ): Promise<{ id: string; providerReference: string }[]>;
  apply(
    provider: string,
    event: VerifiedPaymentEvent,
  ): Promise<string | undefined>;
}

// Rapprochement : relit chez le prestataire le statut des paiements encore en attente, pour ceux
// dont l'adaptateur sait le faire (fetchStatus). Indispensable avec Fapshi, qui n'envoie qu'une
// notification par événement et ne la renvoie jamais. Chaque paiement est relu au plus une fois par
// passage : avec un passage par minute, on reste sous la limite Fapshi (6 requêtes/min par
// transaction). Une erreur sur un paiement n'empêche pas les suivants.
export async function reconcilePayments(
  providers: PaymentProviders,
  store: ReconcileStore,
  includeOld: boolean,
): Promise<{ checked: number; applied: number; failed: number }> {
  const result = { checked: 0, applied: 0, failed: 0 };
  for (const [key, provider] of providers) {
    if (!provider.fetchStatus) continue;
    for (const payment of await store.pending(key, includeOld)) {
      result.checked++;
      try {
        const verified = await provider.fetchStatus(payment.providerReference);
        if (!verified.ok) {
          result.failed++;
          continue;
        }
        if ((await store.apply(key, verified.event)) === "APPLIED")
          result.applied++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}
