import { CinetPayProvider } from "./cinetpay";
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
  // CinetPay : actif seulement si les identifiants du site marchand sont fournis. SANDBOX par
  // défaut ; LIVE uniquement sur déclaration explicite (après validation sandbox et contrat).
  if (env.CINETPAY_API_KEY && env.CINETPAY_SITE_ID) {
    const mode = env.CINETPAY_MODE ?? "SANDBOX";
    if (mode !== "SANDBOX" && mode !== "LIVE")
      throw new Error("CINETPAY_MODE must be SANDBOX or LIVE");
    providers.set(
      "cinetpay",
      new CinetPayProvider({
        apiKey: env.CINETPAY_API_KEY,
        siteId: env.CINETPAY_SITE_ID,
        mode,
        ...(env.CINETPAY_API_BASE ? { apiBase: env.CINETPAY_API_BASE } : {}),
      }),
    );
  }
  return providers;
}
