import type { PaymentProvider, VerifiedPaymentEvent } from "./provider";
import type { PaymentProviders } from "./registry";

// Accès base injecté (le paquet paiements ne dépend pas de la base) : liste des paiements en
// attente d'un prestataire, et application d'un événement vérifié (apply_payment_event).
export interface ReconcileStore {
  pending(
    provider: string,
    includeOld: boolean,
  ): Promise<
    { id: string; providerReference: string; storeAccountId?: string | null }[]
  >;
  apply(
    provider: string,
    event: VerifiedPaymentEvent,
    accountId: string | null,
  ): Promise<string | undefined>;
  // Mode direct (lot 3) : adaptateur construit avec les identifiants du compte du vendeur.
  accountProvider?(accountId: string): Promise<PaymentProvider | undefined>;
  accountKeys?: readonly string[];
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
  // Prestataires de la plateforme, plus ceux des comptes vendeurs (mode direct) même si la
  // plateforme n'a pas d'identifiants chez eux.
  const keys = new Set([...providers.keys(), ...(store.accountKeys ?? [])]);
  for (const key of keys) {
    const provider = providers.get(key);
    // Prestataire de la plateforme sans relecture et sans compte vendeur : rien à relire.
    if (!provider?.fetchStatus && !store.accountKeys?.includes(key)) continue;
    for (const payment of await store.pending(key, includeOld)) {
      const accountId = payment.storeAccountId ?? null;
      if (!accountId && !provider?.fetchStatus) continue;
      result.checked++;
      try {
        const reader = accountId
          ? await store.accountProvider?.(accountId)
          : provider;
        if (!reader?.fetchStatus) {
          result.failed++;
          continue;
        }
        const verified = await reader.fetchStatus(payment.providerReference);
        if (!verified.ok) {
          result.failed++;
          continue;
        }
        if ((await store.apply(key, verified.event, accountId)) === "APPLIED")
          result.applied++;
      } catch {
        result.failed++;
      }
    }
  }
  return result;
}
