// Contrat commun des prestataires de paiement (docs/PAYMENTS.md, ADR 0007).
// Le backend reste la source de vérité : seul un événement vérifié change un statut.

// MOCK : simulateur local, aucun argent réel ; SANDBOX : environnement de test du prestataire ; LIVE : production.
export type PaymentMode = "MOCK" | "SANDBOX" | "LIVE";

export interface InitiatePaymentInput {
  // Notre identifiant de paiement, transmis comme référence marchand : un webhook arrivé avant
  // la réponse d'initiation retrouve quand même son paiement.
  paymentId: string;
  amountMinor: bigint;
  currency: string;
  methodCode: string;
  payerPhone: string | null;
  description: string;
  kind: "MOBILE_MONEY" | "CARD" | "BANK_TRANSFER" | "WALLET";
  // URL publique de notification (webhook) et de retour du payeur, calculées par l'API.
  notifyUrl: string;
  returnUrl: string;
}

export type NextAction =
  // Le payeur valide sur son téléphone (USSD/push opérateur).
  | { type: "approve_on_phone" }
  // Page de paiement hébergée par le prestataire.
  | { type: "redirect"; url: string }
  // Mode MOCK uniquement : validation via le simulateur local.
  | { type: "test_simulator" };

export type InitiatePaymentResult =
  | { ok: true; providerReference: string; nextAction: NextAction }
  | { ok: false; failureCode: string };

export interface VerifiedPaymentEvent {
  eventId: string;
  paymentId: string;
  providerReference: string;
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  amountMinor: bigint;
  currency: string;
  occurredAt: Date;
  failureCode: string | null;
  // Charge utile conservée pour l'audit et le rapprochement (jamais de données carte).
  payload: unknown;
  // Empreinte de dédoublonnage fournie par l'adaptateur quand le corps brut varie d'un envoi
  // à l'autre pour un même fait (ex. statut vérifié par appel API) ; sinon SHA-256 du corps.
  fingerprint?: string;
}

export type WebhookVerification =
  | { ok: true; event: VerifiedPaymentEvent }
  | {
      ok: false;
      reason: "missing_signature" | "bad_signature" | "stale" | "malformed";
    };

// Capacités déclarées par chaque adaptateur, d'après la documentation du prestataire (ADR 0011) :
// un mode d'encaissement qui exige une capacité absente est refusé au démarrage.
export type ProviderCapability =
  // Encaisser un paiement.
  | "collect"
  // Paiement validé sur le téléphone de l'acheteur, sans page hébergée (push USSD).
  | "ussdPush"
  // Un compte marchand par vendeur, identifiants fournis par le vendeur (mode direct).
  | "perMerchantCredentials"
  | "refund"
  | "payout"
  | "balance"
  // Répartition d'un paiement entre plusieurs bénéficiaires (séquestre d'un prestataire agréé).
  | "split";

export interface PaymentProvider {
  // Clé d'adaptateur référencée par les moyens de paiement configurés (ex. « mock »).
  readonly key: string;
  readonly mode: PaymentMode;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult>;
  // Vérifie l'authenticité (signature sur le corps brut, ou statut relu chez le prestataire),
  // la fraîcheur et la forme, avant toute écriture. Une erreur réseau lève une exception :
  // le webhook répond alors 500 et le prestataire réessaie.
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    now?: Date,
  ): WebhookVerification | Promise<WebhookVerification>;
  // Relecture du statut chez le prestataire par sa référence (rapprochement par le worker,
  // quand le prestataire ne renvoie pas une notification perdue). Facultatif.
  fetchStatus?(
    providerReference: string,
    now?: Date,
  ): Promise<WebhookVerification>;
  // Capacités facultatives (séquestre, reversements) : aucun adaptateur actuel ne les fournit.
  refund?(input: {
    paymentId: string;
    providerReference: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<
    { ok: true; reference: string } | { ok: false; failureCode: string }
  >;
  payout?(input: {
    payoutId: string;
    destination: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<
    { ok: true; reference: string } | { ok: false; failureCode: string }
  >;
  getBalance?(): Promise<{ amountMinor: bigint; currency: string }>;
  splitPayment?(input: {
    paymentId: string;
    shares: { beneficiary: string; amountMinor: bigint }[];
  }): Promise<{ ok: true } | { ok: false; failureCode: string }>;
}
