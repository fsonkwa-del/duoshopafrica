import { describe, expect, it } from "vitest";
import { CinetPayProvider } from "./cinetpay";
import { providersFromEnv } from "./registry";

// Faux serveur CinetPay : enregistre les appels et renvoie la réponse prévue par chemin.
function fakeApi(
  responses: Record<string, { status?: number; body: unknown }>,
) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const http = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    const r = responses[path] ?? { status: 404, body: {} };
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { http, calls };
}
const settings = { apiKey: "key", siteId: "105", mode: "SANDBOX" as const };
const input = {
  paymentId: "6f1c1d1e-0000-4000-8000-000000000001",
  amountMinor: 26500n,
  currency: "XAF",
  methodCode: "MTN_MOMO_CM",
  payerPhone: "+237677112233",
  description: "DuoShop 6F1C1D1E",
  kind: "MOBILE_MONEY" as const,
  notifyUrl: "https://shop.example/v1/payments/webhooks/cinetpay",
  returnUrl: "https://shop.example/v1/payments/return?order=x",
};
const notification = (site = "105") =>
  Buffer.from(
    new URLSearchParams({
      cpm_trans_id: input.paymentId,
      cpm_site_id: site,
    }).toString(),
  );

describe("CinetPay adapter (contract, fake API)", () => {
  it("initiates with our payment id and returns the hosted payment page", async () => {
    const api = fakeApi({
      "/v2/payment": {
        body: {
          code: "201",
          data: { payment_url: "https://checkout.cinetpay.com/payment/abc" },
        },
      },
    });
    const result = await new CinetPayProvider(settings, api.http).initiate(
      input,
    );
    expect(result).toEqual({
      ok: true,
      providerReference: input.paymentId,
      nextAction: {
        type: "redirect",
        url: "https://checkout.cinetpay.com/payment/abc",
      },
    });
    expect(api.calls[0]?.body).toMatchObject({
      site_id: "105",
      transaction_id: input.paymentId,
      amount: 26500,
      currency: "XAF",
      channels: "MOBILE_MONEY",
    });
  });

  it("reports a refused initiation and unsupported currencies without calling", async () => {
    const api = fakeApi({
      "/v2/payment": {
        body: { code: "613", message: "ERROR_SITE_ID_NOTVALID" },
      },
    });
    const provider = new CinetPayProvider(settings, api.http);
    expect(await provider.initiate(input)).toEqual({
      ok: false,
      failureCode: "cinetpay_613",
    });
    expect(await provider.initiate({ ...input, currency: "EUR" })).toEqual({
      ok: false,
      failureCode: "currency_unsupported",
    });
    expect(api.calls).toHaveLength(1);
  });

  it("trusts only the status re-read from CinetPay, never the notification body", async () => {
    const api = fakeApi({
      "/v2/payment/check": {
        body: {
          code: "00",
          message: "SUCCES",
          data: { status: "ACCEPTED", amount: "26500", currency: "XAF" },
        },
      },
    });
    const provider = new CinetPayProvider(settings, api.http);
    const result = await provider.verifyWebhook(notification(), {});
    expect(result.ok && result.event).toMatchObject({
      eventId: `${input.paymentId}:ACCEPTED`,
      paymentId: input.paymentId,
      status: "SUCCEEDED",
      amountMinor: 26500n,
      currency: "XAF",
    });
    expect(api.calls[0]?.body).toEqual({
      apikey: "key",
      site_id: "105",
      transaction_id: input.paymentId,
    });
    // Deux notifications du même statut : même empreinte (doublon, pas de quarantaine).
    const again = await provider.verifyWebhook(notification(), {});
    expect(again.ok && again.event.fingerprint).toBe(
      result.ok && result.event.fingerprint,
    );
  });

  it("maps refusals and in-progress statuses; rejects other sites and malformed checks", async () => {
    const refused = fakeApi({
      "/v2/payment/check": {
        body: {
          code: "627",
          message: "TRANSACTION_CANCEL",
          data: { status: "REFUSED", amount: "26500", currency: "XAF" },
        },
      },
    });
    const r = await new CinetPayProvider(settings, refused.http).verifyWebhook(
      notification(),
      {},
    );
    expect(r.ok && [r.event.status, r.event.failureCode]).toEqual([
      "FAILED",
      "cinetpay_transaction_cancel",
    ]);
    const waiting = fakeApi({
      "/v2/payment/check": {
        body: { data: { status: "PENDING", amount: "26500", currency: "XAF" } },
      },
    });
    const w = await new CinetPayProvider(settings, waiting.http).verifyWebhook(
      notification(),
      {},
    );
    expect(w.ok && w.event.status).toBe("PENDING");
    const api = fakeApi({});
    const provider = new CinetPayProvider(settings, api.http);
    expect(await provider.verifyWebhook(notification("999"), {})).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(await provider.verifyWebhook(Buffer.from("x=1"), {})).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(api.calls).toHaveLength(0);
    const broken = fakeApi({ "/v2/payment/check": { body: { data: {} } } });
    expect(
      await new CinetPayProvider(settings, broken.http).verifyWebhook(
        notification(),
        {},
      ),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("raises on provider outage so the notification is retried", async () => {
    const down = fakeApi({
      "/v2/payment/check": { status: 503, body: {} },
    });
    await expect(
      new CinetPayProvider(settings, down.http).verifyWebhook(
        notification(),
        {},
      ),
    ).rejects.toThrow(/unavailable/);
  });

  it("is registered only with credentials, in SANDBOX unless LIVE is explicit", () => {
    expect(providersFromEnv({}).has("cinetpay")).toBe(false);
    expect(
      providersFromEnv({ CINETPAY_API_KEY: "k", CINETPAY_SITE_ID: "1" }).get(
        "cinetpay",
      )?.mode,
    ).toBe("SANDBOX");
    expect(
      providersFromEnv({
        CINETPAY_API_KEY: "k",
        CINETPAY_SITE_ID: "1",
        CINETPAY_MODE: "LIVE",
      }).get("cinetpay")?.mode,
    ).toBe("LIVE");
    expect(() =>
      providersFromEnv({
        CINETPAY_API_KEY: "k",
        CINETPAY_SITE_ID: "1",
        CINETPAY_MODE: "TEST",
      }),
    ).toThrow();
  });
});
