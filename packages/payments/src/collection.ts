import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { FapshiProvider } from "./fapshi";
import { MockPaymentProvider } from "./mock";
import type {
  PaymentMode,
  PaymentProvider,
  ProviderCapability,
} from "./provider";
import type { PaymentProviders } from "./registry";

// Modes d'encaissement (ADR 0011) : qui détient l'argent de l'acheteur.
export type CollectionMode = "PLATFORM_HELD" | "DIRECT_SELLER" | "PSP_ESCROW";
const MODES: readonly CollectionMode[] = [
  "PLATFORM_HELD",
  "DIRECT_SELLER",
  "PSP_ESCROW",
];

// Capacités qu'un mode exige d'au moins un prestataire configuré.
export const REQUIRED_CAPABILITIES: Record<
  CollectionMode,
  readonly ProviderCapability[]
> = {
  PLATFORM_HELD: ["collect"],
  DIRECT_SELLER: ["collect", "perMerchantCredentials"],
  PSP_ESCROW: ["collect", "split", "payout", "refund", "balance"],
};

export interface CollectionSettings {
  mode: CollectionMode;
  // Clés de chiffrement des identifiants marchands, par version (rotation sans perte).
  keys: ReadonlyMap<number, Buffer>;
  currentKeyVersion: number;
}

// COLLECTION_MODE (défaut PLATFORM_HELD hors production, obligatoire en production) et clés
// PAYMENT_ACCOUNTS_KEY_<n> (32 octets en base64), PAYMENT_ACCOUNTS_KEY_VERSION = version courante.
export function collectionFromEnv(
  env: Record<string, string | undefined>,
): CollectionSettings {
  const raw = env.COLLECTION_MODE;
  if (!raw && env.NODE_ENV === "production")
    throw new Error("COLLECTION_MODE is required in production");
  const mode = (raw ?? "PLATFORM_HELD") as CollectionMode;
  if (!MODES.includes(mode))
    throw new Error(`COLLECTION_MODE must be one of ${MODES.join(", ")}`);
  const keys = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^PAYMENT_ACCOUNTS_KEY_(\d+)$/.exec(name);
    if (!match || !value) continue;
    const key = Buffer.from(value, "base64");
    if (key.length !== 32)
      throw new Error(`${name} must be 32 bytes encoded in base64`);
    keys.set(Number(match[1]), key);
  }
  const currentKeyVersion = Number(env.PAYMENT_ACCOUNTS_KEY_VERSION ?? "1");
  if (mode === "DIRECT_SELLER" && !keys.has(currentKeyVersion))
    throw new Error(
      `DIRECT_SELLER requires PAYMENT_ACCOUNTS_KEY_${currentKeyVersion}`,
    );
  return { mode, keys, currentKeyVersion };
}

// Le mode est-il servi par les prestataires configurés ? Liste des capacités manquantes.
export function missingCapabilities(
  mode: CollectionMode,
  providers: PaymentProviders,
): ProviderCapability[] {
  const required = REQUIRED_CAPABILITIES[mode];
  const best = [...providers.values()].map((p) =>
    required.filter((c) => !p.capabilities.has(c)),
  );
  if (best.length === 0) return [...required];
  return best.reduce((a, b) => (b.length < a.length ? b : a));
}

// ---------- Identifiants des comptes marchands : AES-256-GCM, clé hors base ----------
export interface MerchantCredentials {
  // Fapshi : apiUser, apiKey, webhookSecret ; simulateur : secret.
  [field: string]: string;
}
// Format : iv (12 octets) | tag (16 octets) | texte chiffré.
export function sealCredentials(
  credentials: MerchantCredentials,
  settings: CollectionSettings,
): { sealed: Buffer; keyVersion: number } {
  const key = settings.keys.get(settings.currentKeyVersion);
  if (!key) throw new Error("No payment account key configured");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  return {
    sealed: Buffer.concat([iv, cipher.getAuthTag(), body]),
    keyVersion: settings.currentKeyVersion,
  };
}
export function openCredentials(
  sealed: Buffer,
  keyVersion: number,
  settings: CollectionSettings,
): MerchantCredentials {
  const key = settings.keys.get(keyVersion);
  if (!key) throw new Error(`Payment account key ${keyVersion} is missing`);
  const decipher = createDecipheriv("aes-256-gcm", key, sealed.subarray(0, 12));
  decipher.setAuthTag(sealed.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(sealed.subarray(28)),
      decipher.final(),
    ]).toString("utf8"),
  ) as MerchantCredentials;
}

// Adaptateur construit pour le compte marchand d'un vendeur (mode direct). Le simulateur reste
// interdit en production, comme dans le registre.
export function providerForAccount(
  provider: string,
  mode: PaymentMode,
  credentials: MerchantCredentials,
  env: Record<string, string | undefined>,
): PaymentProvider {
  if (provider === "fapshi") {
    if (mode !== "SANDBOX" && mode !== "LIVE")
      throw new Error("Fapshi accounts are SANDBOX or LIVE");
    return new FapshiProvider({
      apiUser: credentials.apiUser ?? "",
      apiKey: credentials.apiKey ?? "",
      webhookSecret: credentials.webhookSecret ?? "",
      mode,
      ...(env.FAPSHI_API_BASE ? { apiBase: env.FAPSHI_API_BASE } : {}),
    });
  }
  if (provider === "mock") {
    if (env.NODE_ENV === "production" || env.PAYMENTS_MOCK_ENABLED !== "true")
      throw new Error("The simulator is disabled");
    if (!credentials.secret) throw new Error("Simulator secret required");
    return new MockPaymentProvider(credentials.secret);
  }
  throw new Error(`No merchant account support for ${provider}`);
}
// Champs attendus par prestataire, pour valider la saisie du vendeur.
export const MERCHANT_FIELDS: Record<string, readonly string[]> = {
  fapshi: ["apiUser", "apiKey", "webhookSecret"],
  mock: ["secret"],
};
