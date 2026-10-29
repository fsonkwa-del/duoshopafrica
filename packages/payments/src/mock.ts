import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type {
  InitiatePaymentInput,
  InitiatePaymentResult,
  PaymentProvider,
  WebhookVerification,
} from "./provider";

// Adaptateur de test : aucun argent ne circule. Il emprunte pourtant le même chemin qu'un vrai
// prestataire (webhook signé HMAC, horodaté, vérifié sur le corps brut) pour éprouver ce chemin.
export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
export const MOCK_TOLERANCE_SECONDS = 300;

export interface MockEventInput {
  eventId?: string;
  paymentId: string;
  providerReference: string;
  status: "SUCCEEDED" | "FAILED" | "PENDING";
  amountMinor: bigint;
  currency: string;
  failureCode?: string;
  occurredAt?: Date;
}

export function mockEventBody(input: MockEventInput): string {
  return JSON.stringify({
    id: input.eventId ?? `evt_${randomUUID()}`,
    type: `payment.${input.status.toLowerCase()}`,
    createdAt: (input.occurredAt ?? new Date()).toISOString(),
    data: {
      paymentId: input.paymentId,
      reference: input.providerReference,
      amountMinor: input.amountMinor.toString(),
      currency: input.currency,
      ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    },
  });
}

export function signMockBody(
  secret: string,
  body: string | Buffer,
  now = new Date(),
): string {
  const timestamp = Math.floor(now.getTime() / 1000);
  const mac = createHmac("sha256", secret)
    .update(`${timestamp}.`)
    .update(body)
    .digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

const statuses = {
  "payment.succeeded": "SUCCEEDED",
  "payment.failed": "FAILED",
  "payment.pending": "PENDING",
} as const;

function text(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

export class MockPaymentProvider implements PaymentProvider {
  readonly key = "mock";
  readonly mode = "MOCK" as const;
  constructor(private readonly secret: string) {
    if (secret.length < 32)
      throw new Error("PAYMENTS_MOCK_SECRET must be at least 32 characters");
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    return {
      ok: true,
      providerReference: `mock_${input.paymentId.replaceAll("-", "")}`,
      nextAction: { type: "test_simulator" },
    };
  }

  sign(body: string, now?: Date): string {
    return signMockBody(this.secret, body, now);
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
    now = new Date(),
  ): WebhookVerification {
    const header = headers[MOCK_SIGNATURE_HEADER];
    if (typeof header !== "string")
      return { ok: false, reason: "missing_signature" };
    const parts = new Map(
      header.split(",").map((p) => {
        const i = p.indexOf("=");
        return [p.slice(0, i), p.slice(i + 1)] as const;
      }),
    );
    const timestamp = Number(parts.get("t"));
    const given = parts.get("v1") ?? "";
    if (!Number.isInteger(timestamp) || !/^[0-9a-f]{64}$/.test(given))
      return { ok: false, reason: "missing_signature" };
    const expected = createHmac("sha256", this.secret)
      .update(`${timestamp}.`)
      .update(rawBody)
      .digest();
    // Comparaison en temps constant, avant tout examen du contenu.
    if (!timingSafeEqual(expected, Buffer.from(given, "hex")))
      return { ok: false, reason: "bad_signature" };
    if (Math.abs(now.getTime() / 1000 - timestamp) > MOCK_TOLERANCE_SECONDS)
      return { ok: false, reason: "stale" };
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return { ok: false, reason: "malformed" };
    }
    if (typeof payload !== "object" || payload === null)
      return { ok: false, reason: "malformed" };
    const p = payload as Record<string, unknown>;
    const data = (p.data ?? {}) as Record<string, unknown>;
    const status = statuses[p.type as keyof typeof statuses];
    const eventId = text(p.id, 100);
    const paymentId = text(data.paymentId, 36);
    const reference = text(data.reference, 100);
    const currency = text(data.currency, 3);
    const amount = text(data.amountMinor, 19);
    const occurredAt = new Date(String(p.createdAt));
    if (
      !status ||
      !eventId ||
      !paymentId ||
      !reference ||
      !currency ||
      !amount ||
      !/^[0-9]+$/.test(amount) ||
      Number.isNaN(occurredAt.getTime())
    )
      return { ok: false, reason: "malformed" };
    return {
      ok: true,
      event: {
        eventId,
        paymentId,
        providerReference: reference,
        status,
        amountMinor: BigInt(amount),
        currency,
        occurredAt,
        failureCode: text(data.failureCode, 64),
        payload,
      },
    };
  }
}
