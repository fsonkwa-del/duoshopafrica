import { createHash } from "node:crypto";
import type {
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentMode,
  PaymentProvider,
  WebhookVerification,
} from "./provider";

// Adaptateur CinetPay (agrégateur Mobile Money / cartes, Afrique francophone).
// Écrit d'après la documentation publique (docs.cinetpay.com, API « 1.0 » / endpoints v2) ;
// NON TESTÉ contre l'API réelle : à valider en sandbox avant toute activation (ADR 0007).
//
// Sécurité : la notification n'est qu'un déclencheur. Le statut fait foi seulement après
// l'appel serveur à serveur POST /v2/payment/check (recommandation CinetPay) ; montant et devise
// sont ensuite comparés au paiement local par apply_payment_event. Le jeton x-token (HMAC) n'est
// pas vérifié tant que l'ordre exact des champs signés n'est pas confirmé en sandbox.
export interface CinetPaySettings {
  apiKey: string;
  siteId: string;
  mode: PaymentMode;
  apiBase?: string;
}
type Fetch = typeof fetch;

// Devises sans sous-unité acceptées : unités mineures = montant entier.
const SUPPORTED = new Set(["XAF", "XOF"]);
const channels: Record<InitiatePaymentInput["kind"], string> = {
  MOBILE_MONEY: "MOBILE_MONEY",
  CARD: "CREDIT_CARD",
  WALLET: "WALLET",
  BANK_TRANSFER: "ALL",
};

function text(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : typeof value === "number"
      ? String(value)
      : null;
}

export class CinetPayProvider implements PaymentProvider {
  readonly key = "cinetpay";
  readonly mode: PaymentMode;
  private readonly base: string;

  constructor(
    private readonly settings: CinetPaySettings,
    private readonly http: Fetch = fetch,
  ) {
    if (!settings.apiKey || !settings.siteId)
      throw new Error("CINETPAY_API_KEY and CINETPAY_SITE_ID are required");
    this.mode = settings.mode;
    this.base = (
      settings.apiBase ?? "https://api-checkout.cinetpay.com"
    ).replace(/\/$/, "");
  }

  private async post(
    path: string,
    body: object,
  ): Promise<Record<string, unknown>> {
    const response = await this.http(`${this.base}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (response.status >= 500)
      throw new Error(`CinetPay ${path} unavailable (${response.status})`);
    return json;
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    if (!SUPPORTED.has(input.currency))
      return { ok: false, failureCode: "currency_unsupported" };
    const json = await this.post("/v2/payment", {
      apikey: this.settings.apiKey,
      site_id: this.settings.siteId,
      // Notre identifiant de paiement : unique, et retrouvé tel quel dans la vérification.
      transaction_id: input.paymentId,
      amount: Number(input.amountMinor),
      currency: input.currency,
      description: input.description,
      notify_url: input.notifyUrl,
      return_url: input.returnUrl,
      channels: channels[input.kind],
    });
    const data = (json.data ?? {}) as Record<string, unknown>;
    const url = text(data.payment_url, 500);
    if (json.code !== "201" || !url || !url.startsWith("https://"))
      return {
        ok: false,
        failureCode: `cinetpay_${text(json.code, 10) ?? "error"}`,
      };
    return {
      ok: true,
      providerReference: input.paymentId,
      nextAction: { type: "redirect", url },
    };
  }

  async verifyWebhook(
    rawBody: Buffer,
    _headers: Record<string, string | string[] | undefined>,
    now = new Date(),
  ): Promise<WebhookVerification> {
    // Notification en application/x-www-form-urlencoded (ou JSON) : cpm_trans_id, cpm_site_id.
    const raw = rawBody.toString("utf8");
    let fields: Record<string, unknown>;
    try {
      fields = raw.trimStart().startsWith("{")
        ? (JSON.parse(raw) as Record<string, unknown>)
        : Object.fromEntries(new URLSearchParams(raw));
    } catch {
      return { ok: false, reason: "malformed" };
    }
    const transactionId = text(fields.cpm_trans_id, 100);
    if (!transactionId) return { ok: false, reason: "malformed" };
    if (text(fields.cpm_site_id, 50) !== this.settings.siteId)
      return { ok: false, reason: "bad_signature" };
    // Source de vérité : statut relu chez CinetPay, jamais le corps de la notification.
    const json = await this.post("/v2/payment/check", {
      apikey: this.settings.apiKey,
      site_id: this.settings.siteId,
      transaction_id: transactionId,
    });
    const data = (json.data ?? {}) as Record<string, unknown>;
    const reported = text(data.status, 40);
    const amount = text(data.amount, 19);
    const currency = text(data.currency, 3);
    if (!reported || !amount || !/^[0-9]+$/.test(amount) || !currency)
      return { ok: false, reason: "malformed" };
    const status =
      reported === "ACCEPTED"
        ? ("SUCCEEDED" as const)
        : reported === "REFUSED" || reported === "EXPIRED"
          ? ("FAILED" as const)
          : ("PENDING" as const);
    const paidAt = new Date(String(data.payment_date ?? ""));
    const facts = { transactionId, status: reported, amount, currency };
    return {
      ok: true,
      event: {
        // Un même statut relu plusieurs fois = un seul événement (dédoublonnage).
        eventId: `${transactionId}:${reported}`,
        paymentId: transactionId,
        providerReference: transactionId,
        status,
        amountMinor: BigInt(amount),
        currency,
        occurredAt: Number.isNaN(paidAt.getTime()) ? now : paidAt,
        failureCode:
          status === "FAILED"
            ? `cinetpay_${(text(json.message, 40) ?? reported).toLowerCase()}`
            : null,
        payload: { notification: fields, check: { code: json.code, data } },
        fingerprint: createHash("sha256")
          .update(JSON.stringify(facts))
          .digest("hex"),
      },
    };
  }
}
