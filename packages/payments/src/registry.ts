import { MockPaymentProvider } from "./mock";
import type { PaymentProvider } from "./provider";

// Les secrets des prestataires viennent de l'environnement (gestionnaire de secrets), jamais de
// la base : un moyen de paiement configuré par l'administration ne référence qu'une clé d'adaptateur.
export type PaymentProviders = ReadonlyMap<string, PaymentProvider>;

export function providersFromEnv(
  env: Record<string, string | undefined>,
): PaymentProviders {
  const providers = new Map<string, PaymentProvider>();
  if (env.PAYMENTS_MOCK_ENABLED === "true") {
    // Garde-fou : un simulateur ne peut jamais encaisser en production.
    if (env.NODE_ENV === "production")
      throw new Error("PAYMENTS_MOCK_ENABLED is forbidden in production");
    const secret = env.PAYMENTS_MOCK_SECRET;
    if (!secret) throw new Error("PAYMENTS_MOCK_SECRET is required");
    providers.set("mock", new MockPaymentProvider(secret));
  }
  // Prestataires réels : ajoutés ici avec leur adaptateur, une fois contrat et sandbox obtenus.
  return providers;
}
