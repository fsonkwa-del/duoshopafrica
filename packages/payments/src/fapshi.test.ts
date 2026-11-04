import { describe, expect, it } from "vitest";
import { FapshiProvider } from "./fapshi";
import { providersFromEnv } from "./registry";

// Faux serveur Fapshi : enregistre les appels et renvoie la réponse prévue par chemin.
function fakeApi(
  responses: Record<string, { status?: number; body: unknown }>,
) {
  const calls: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: Record<string, unknown> | null;
  }[] = [];
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const r = responses[path] ?? { status: 404, body: { message: "none" } };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { http, calls };
}
const settings = {
  apiUser: "user",
  apiKey: "key",
  webhookSecret: "wh-secret",
  mode: "SANDBOX" as const,
};
const input = {
  paymentId: "6f1c1d1e-0000-4000-8000-000000000001",
  amountMinor: 26500n,
  currency: "XAF",
  methodCode: "MTN_MOMO_CM",
  payerPhone: "+237677112233",
  description: "DuoShop 6F1C1D1E",
  kind: "MOBILE_MONEY" as const,
  notifyUrl: "https://shop.example/v1/payments/webhooks/fapshi",
  returnUrl: "https://shop.example/v1/payments/return?order=x",
};
const status = (fields: Record<string, unknown> = {}) => ({
  "/payment-status/T123": {
    body: {
      transId: "T123",
      status: "SUCCESSFUL",
      transType: "Collection",
      amount: 26500,
      revenue: 25705,
      externalId: input.paymentId,
      ...fields,
    },
  },
});
const webhook = (body: unknown = { transId: "T123" }) =>
  Buffer.from(JSON.stringify(body));

describe("Fapshi adapter (contract, fake API)", () => {
  it("creates a payment link on the sandbox with our payment id", async () => {
    const api = fakeApi({
      "/initiate-pay": {
        body: {
          message: "Request successful",
          link: "https://checkout.fapshi.com/link/abc",
          transId: "T123",
        },
      },
    });
    const result = await new FapshiProvider(settings, api.http).initiate(input);
    expect(result).toEqual({
      ok: true,
      providerReference: "T123",
      nextAction: {
        type: "redirect",
        url: "https://checkout.fapshi.com/link/abc",
      },
    });
    const call = api.calls[0];
    expect(call?.url).toBe("https://sandbox.fapshi.com/initiate-pay");
    expect(call?.method).toBe("POST");
    expect(call?.headers).toMatchObject({ apiuser: "user", apikey: "key" });
    expect(call?.body).toEqual({
      amount: 26500,
      externalId: input.paymentId,
      userId: input.paymentId,
      redirectUrl: input.returnUrl,
      message: input.description,
    });
  });

  it("refuses what Fapshi cannot collect, without calling it", async () => {
    const api = fakeApi({});
    const fapshi = new FapshiProvider(settings, api.http);
    expect(await fapshi.initiate({ ...input, currency: "XOF" })).toEqual({
      ok: false,
      failureCode: "currency_unsupported",
    });
    expect(await fapshi.initiate({ ...input, kind: "CARD" })).toEqual({
      ok: false,
      failureCode: "method_unsupported",
    });
    expect(await fapshi.initiate({ ...input, amountMinor: 99n })).toEqual({
      ok: false,
      failureCode: "amount_below_minimum",
    });
    expect(api.calls).toHaveLength(0);
  });

  it("reports a refused request, and throws when Fapshi is unavailable", async () => {
    const refused = fakeApi({
      "/initiate-pay": { status: 400, body: { message: "Invalid amount" } },
    });
    expect(
      await new FapshiProvider(settings, refused.http).initiate(input),
    ).toEqual({ ok: false, failureCode: "fapshi_400" });
    const down = fakeApi({ "/initiate-pay": { status: 503, body: {} } });
    await expect(
      new FapshiProvider(settings, down.http).initiate(input),
    ).rejects.toThrow(/unavailable/);
  });

  it("accepts a webhook only with the shared secret, then trusts the status read back", async () => {
    const api = fakeApi(status());
    const fapshi = new FapshiProvider(settings, api.http);
    expect(await fapshi.verifyWebhook(webhook(), {})).toEqual({
      ok: false,
      reason: "missing_signature",
    });
    expect(
      await fapshi.verifyWebhook(webhook(), { "x-wh-secret": "guess" }),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(api.calls).toHaveLength(0);
    // Le corps prétend un échec : seul le statut relu chez Fapshi compte.
    const verified = await fapshi.verifyWebhook(
      webhook({ transId: "T123", status: "FAILED", amount: 1 }),
      { "x-wh-secret": "wh-secret" },
    );
    expect(verified.ok && verified.event).toMatchObject({
      eventId: "T123:SUCCESSFUL",
      paymentId: input.paymentId,
      providerReference: "T123",
      status: "SUCCEEDED",
      amountMinor: 26500n,
      currency: "XAF",
      failureCode: null,
    });
    expect(api.calls[0]?.url).toBe(
      "https://sandbox.fapshi.com/payment-status/T123",
    );
    expect(api.calls[0]?.method).toBe("GET");
    expect(api.calls[0]?.body).toBeNull();
  });

  it("maps every Fapshi status", async () => {
    for (const [reported, expected] of [
      ["CREATED", "PENDING"],
      ["PENDING", "PENDING"],
      ["FAILED", "FAILED"],
      ["EXPIRED", "FAILED"],
    ] as const) {
      const fapshi = new FapshiProvider(
        settings,
        fakeApi(status({ status: reported })).http,
      );
      const result = await fapshi.fetchStatus("T123");
      expect(result.ok && result.event.status).toBe(expected);
      if (expected === "FAILED")
        expect(result.ok && result.event.failureCode).toBe(
          `fapshi_${reported.toLowerCase()}`,
        );
    }
  });

  it("rejects malformed or foreign statuses, and throws on rate limit", async () => {
    const ok = { "x-wh-secret": "wh-secret" };
    const fapshi = (fields: Record<string, unknown>) =>
      new FapshiProvider(settings, fakeApi(status(fields)).http);
    expect(await fapshi({}).verifyWebhook(Buffer.from("{"), ok)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(
      await fapshi({}).verifyWebhook(webhook({ transId: "../x" }), ok),
    ).toEqual({ ok: false, reason: "malformed" });
    for (const fields of [
      { transId: "OTHER" },
      { status: "REVERSED" },
      { amount: "26500" },
      { externalId: undefined },
      { transType: "Payout" },
    ])
      expect(await fapshi(fields).fetchStatus("T123")).toEqual({
        ok: false,
        reason: "malformed",
      });
    const unknown = new FapshiProvider(settings, fakeApi({}).http);
    expect(await unknown.fetchStatus("T123")).toEqual({
      ok: false,
      reason: "malformed",
    });
    const limited = new FapshiProvider(
      settings,
      fakeApi({ "/payment-status/T123": { status: 429, body: {} } }).http,
    );
    await expect(limited.fetchStatus("T123")).rejects.toThrow(/unavailable/);
  });

  it("same status read twice gives the same event fingerprint", async () => {
    const fapshi = new FapshiProvider(settings, fakeApi(status()).http);
    const a = await fapshi.fetchStatus("T123", new Date(1));
    const b = await fapshi.fetchStatus("T123", new Date(2));
    expect(a.ok && b.ok && a.event.fingerprint === b.event.fingerprint).toBe(
      true,
    );
  });
});

describe("Fapshi registration", () => {
  it("stays off without credentials and defaults to the sandbox", () => {
    expect(providersFromEnv({}).has("fapshi")).toBe(false);
    const providers = providersFromEnv({
      FAPSHI_API_USER: "u",
      FAPSHI_API_KEY: "k",
      FAPSHI_WEBHOOK_SECRET: "s",
    });
    expect(providers.get("fapshi")?.mode).toBe("SANDBOX");
  });

  it("refuses a partial configuration or an unknown mode", () => {
    expect(() =>
      providersFromEnv({ FAPSHI_API_USER: "u", FAPSHI_API_KEY: "k" }),
    ).toThrow(/FAPSHI_WEBHOOK_SECRET/);
    expect(() =>
      providersFromEnv({
        FAPSHI_API_USER: "u",
        FAPSHI_API_KEY: "k",
        FAPSHI_WEBHOOK_SECRET: "s",
        FAPSHI_MODE: "TEST",
      }),
    ).toThrow(/FAPSHI_MODE/);
  });
});
