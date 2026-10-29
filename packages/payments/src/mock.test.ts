import { describe, expect, it } from "vitest";
import {
  MOCK_SIGNATURE_HEADER,
  MockPaymentProvider,
  mockEventBody,
  providersFromEnv,
  signMockBody,
} from "./index";

const secret = "s".repeat(32);
const provider = new MockPaymentProvider(secret);
const now = new Date("2026-10-29T10:00:00Z");
const body = mockEventBody({
  eventId: "evt_1",
  paymentId: "6f1c1d1e-0000-4000-8000-000000000001",
  providerReference: "mock_ref",
  status: "SUCCEEDED",
  amountMinor: 26500n,
  currency: "XAF",
  occurredAt: now,
});

describe("mock payment provider", () => {
  it("accepts a correctly signed fresh event", () => {
    const result = provider.verifyWebhook(
      Buffer.from(body),
      { [MOCK_SIGNATURE_HEADER]: signMockBody(secret, body, now) },
      now,
    );
    expect(result.ok && result.event).toMatchObject({
      eventId: "evt_1",
      status: "SUCCEEDED",
      amountMinor: 26500n,
      currency: "XAF",
    });
  });

  it("rejects a tampered body, another secret, a missing or stale signature", () => {
    const signature = signMockBody(secret, body, now);
    const tampered = Buffer.from(body.replace("26500", "26"));
    expect(
      provider.verifyWebhook(
        tampered,
        { [MOCK_SIGNATURE_HEADER]: signature },
        now,
      ),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(
      provider.verifyWebhook(
        Buffer.from(body),
        { [MOCK_SIGNATURE_HEADER]: signMockBody("x".repeat(32), body, now) },
        now,
      ),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(provider.verifyWebhook(Buffer.from(body), {}, now)).toEqual({
      ok: false,
      reason: "missing_signature",
    });
    const later = new Date(now.getTime() + 301_000);
    expect(
      provider.verifyWebhook(
        Buffer.from(body),
        { [MOCK_SIGNATURE_HEADER]: signature },
        later,
      ),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("rejects a signed but malformed payload", () => {
    const bad = JSON.stringify({
      id: "evt",
      type: "payment.refunded",
      data: {},
    });
    expect(
      provider.verifyWebhook(
        Buffer.from(bad),
        { [MOCK_SIGNATURE_HEADER]: signMockBody(secret, bad, now) },
        now,
      ),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("is never available in production and needs a strong secret", () => {
    expect(providersFromEnv({}).size).toBe(0);
    expect(
      providersFromEnv({
        PAYMENTS_MOCK_ENABLED: "true",
        PAYMENTS_MOCK_SECRET: secret,
      }).get("mock")?.mode,
    ).toBe("MOCK");
    expect(() =>
      providersFromEnv({
        PAYMENTS_MOCK_ENABLED: "true",
        PAYMENTS_MOCK_SECRET: secret,
        NODE_ENV: "production",
      }),
    ).toThrow(/forbidden in production/);
    expect(() =>
      providersFromEnv({
        PAYMENTS_MOCK_ENABLED: "true",
        PAYMENTS_MOCK_SECRET: "short",
      }),
    ).toThrow();
  });
});
