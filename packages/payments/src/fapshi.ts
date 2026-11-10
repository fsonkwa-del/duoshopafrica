import { createHash, timingSafeEqual } from "node:crypto";
import type {
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentMode,
  PaymentProvider,
  ProviderCapability,
  WebhookVerification,
} from "./provider";

// Adaptateur Fapshi (MTN Mobile Money et Orange Money, Cameroun), d'après la documentation
// publique docs.fapshi.com (initiate-pay, payment-status, webhook, transaction handling).
// À valider en sandbox avant toute activation ; LIVE seulement après contrat et validation.
//
// Ce que la documentation impose et que l'adaptateur respecte :
// - authentification par en-têtes apiuser / apikey ; base sandbox ou live selon le mode ;
// - aucune idempotence chez Fapshi : un seul appel d'initiation par paiement local (notre
//   identifiant de paiement sert d'externalId et de userId pour le retrouver) ;
// - webhook authentifié par un secret statique (x-wh-secret), non signé : le corps n'est qu'un
//   déclencheur, le statut fait foi seulement après GET /payment-status/{transId} ;
// - webhooks jamais renvoyés : le worker relit le statut des paiements en attente (fetchStatus).
export interface FapshiSettings {
  apiUser: string;
  apiKey: string;
  webhookSecret: string;
  mode: PaymentMode;
  apiBase?: string;
}
type Fetch = typeof fetch;

const BASES = {
  SANDBOX: "https://sandbox.fapshi.com",
  LIVE: "https://live.fapshi.com",
} as const;
// Montant minimal accepté par Fapshi (XAF, sans sous-unité).
const MIN_AMOUNT = 100n;
const TRANS_ID = /^[A-Za-z0-9_-]{1,100}$/;

function text(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}
function sameSecret(given: string, expected: string): boolean {
  // Comparaison à temps constant sur des empreintes de longueur fixe.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export class FapshiProvider implements PaymentProvider {
  readonly key = "fapshi";
  readonly mode: PaymentMode;
  // D'après docs.fapshi.com : encaissement par lien. Le paiement direct (push) est refusé aux
  // agrégateurs ; le remboursement n'existe pas ; les reversements passent par un service distinct.
  // Un compte par vendeur reste à confirmer par Fapshi (question P1).
  readonly capabilities: ReadonlySet<ProviderCapability> = new Set([
    "collect",
    "perMerchantCredentials",
  ]);
  private readonly base: string;

  constructor(
    private readonly settings: FapshiSettings,
    private readonly http: Fetch = fetch,
  ) {
    if (!settings.apiUser || !settings.apiKey || !settings.webhookSecret)
      throw new Error(
        "FAPSHI_API_USER, FAPSHI_API_KEY and FAPSHI_WEBHOOK_SECRET are required",
      );
    if (settings.mode !== "SANDBOX" && settings.mode !== "LIVE")
      throw new Error("Fapshi mode must be SANDBOX or LIVE");
    this.mode = settings.mode;
    this.base = (settings.apiBase ?? BASES[settings.mode]).replace(/\/$/, "");
  }

  private headers() {
    return {
      apiuser: this.settings.apiUser,
      apikey: this.settings.apiKey,
      accept: "application/json",
    };
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (input.currency !== "XAF")
      return { ok: false, failureCode: "currency_unsupported" };
    if (input.kind !== "MOBILE_MONEY")
      return { ok: false, failureCode: "method_unsupported" };
    if (input.amountMinor < MIN_AMOUNT)
      return { ok: false, failureCode: "amount_below_minimum" };
    const response = await this.http(`${this.base}/initiate-pay`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({
        amount: Number(input.amountMinor),
        // Notre identifiant de paiement : retrouvé dans le statut (externalId) et permet la
        // recherche GET /transaction/{userId} si la réponse se perd.
        externalId: input.paymentId,
        userId: input.paymentId,
        redirectUrl: input.returnUrl,
        message: input.description,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status >= 500)
      throw new Error(`Fapshi initiate-pay unavailable (${response.status})`);
    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const link = text(json.link, 500);
    const transId = text(json.transId, 100);
    if (
      response.status !== 200 ||
      !link ||
      !link.startsWith("https://") ||
      !transId ||
      !TRANS_ID.test(transId)
    )
      return { ok: false, failureCode: `fapshi_${response.status}` };
    return {
      ok: true,
      providerReference: transId,
      nextAction: { type: "redirect", url: link },
    };
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    now = new Date(),
  ): Promise<WebhookVerification> {
    const secret = headers["x-wh-secret"];
    if (typeof secret !== "string" || secret.length === 0)
      return { ok: false, reason: "missing_signature" };
    if (!sameSecret(secret, this.settings.webhookSecret))
      return { ok: false, reason: "bad_signature" };
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: "malformed" };
    }
    const transId = text(body.transId, 100);
    if (!transId || !TRANS_ID.test(transId))
      return { ok: false, reason: "malformed" };
    return this.fetchStatus(transId, now, body);
  }

  // Source de vérité : statut relu chez Fapshi. Une indisponibilité (429, 5xx, réseau) lève
  // une exception : le webhook répond 500 et le worker réessaiera au passage suivant.
  async fetchStatus(
    transId: string,
    now = new Date(),
    notification: unknown = null,
  ): Promise<WebhookVerification> {
    if (!TRANS_ID.test(transId)) return { ok: false, reason: "malformed" };
    const response = await this.http(
      `${this.base}/payment-status/${encodeURIComponent(transId)}`,
      { headers: this.headers(), signal: AbortSignal.timeout(15_000) },
    );
    // 400/404 : transaction inconnue de Fapshi, jamais un échec de paiement.
    if (response.status === 400 || response.status === 404)
      return { ok: false, reason: "malformed" };
    if (response.status !== 200)
      throw new Error(`Fapshi payment-status unavailable (${response.status})`);
    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const reported = text(data.status, 20);
    const externalId = text(data.externalId, 100);
    const amount = data.amount;
    if (
      text(data.transId, 100) !== transId ||
      !reported ||
      !externalId ||
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      (data.transType !== undefined && data.transType !== "Collection")
    )
      return { ok: false, reason: "malformed" };
    const status =
      reported === "SUCCESSFUL"
        ? ("SUCCEEDED" as const)
        : reported === "FAILED" || reported === "EXPIRED"
          ? ("FAILED" as const)
          : reported === "CREATED" || reported === "PENDING"
            ? ("PENDING" as const)
            : null;
    if (!status) return { ok: false, reason: "malformed" };
    const facts = { transId, status: reported, amount, externalId };
    return {
      ok: true,
      event: {
        // Un même statut relu plusieurs fois (webhook puis worker) = un seul événement.
        eventId: `${transId}:${reported}`,
        paymentId: externalId,
        providerReference: transId,
        status,
        amountMinor: BigInt(amount),
        // Fapshi n'encaisse qu'en XAF.
        currency: "XAF",
        occurredAt: now,
        // Fapshi ne donne jamais la cause d'un échec.
        failureCode:
          status === "FAILED" ? `fapshi_${reported.toLowerCase()}` : null,
        payload: { notification, status: data },
        fingerprint: createHash("sha256")
          .update(JSON.stringify(facts))
          .digest("hex"),
      },
    };
  }
}
