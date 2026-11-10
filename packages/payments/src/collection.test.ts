import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  collectionFromEnv,
  missingCapabilities,
  openCredentials,
  providerForAccount,
  sealCredentials,
} from "./collection";
import { providersFromEnv } from "./registry";

const key = () => randomBytes(32).toString("base64");

describe("collection modes (ADR 0011)", () => {
  it("is explicit in production and needs a key for merchant accounts", () => {
    expect(() => collectionFromEnv({ NODE_ENV: "production" })).toThrow(
      /COLLECTION_MODE is required/,
    );
    expect(() => collectionFromEnv({ COLLECTION_MODE: "OTHER" })).toThrow(
      /COLLECTION_MODE must be/,
    );
    expect(() =>
      collectionFromEnv({ COLLECTION_MODE: "DIRECT_SELLER" }),
    ).toThrow(/PAYMENT_ACCOUNTS_KEY_1/);
    expect(() =>
      collectionFromEnv({ PAYMENT_ACCOUNTS_KEY_1: "dHJvcCBjb3VydA==" }),
    ).toThrow(/32 bytes/);
    expect(collectionFromEnv({}).mode).toBe("PLATFORM_HELD");
  });

  it("refuses a mode whose capabilities no configured provider offers", () => {
    const providers = providersFromEnv({
      FAPSHI_API_USER: "u",
      FAPSHI_API_KEY: "k",
      FAPSHI_WEBHOOK_SECRET: "s",
    });
    expect(missingCapabilities("PLATFORM_HELD", providers)).toEqual([]);
    expect(missingCapabilities("PSP_ESCROW", providers)).toEqual([
      "split",
      "payout",
      "refund",
      "balance",
    ]);
    expect(missingCapabilities("PLATFORM_HELD", new Map())).toEqual([
      "collect",
    ]);
  });

  it("seals merchant credentials and opens them with the key of their version only", () => {
    const settings = collectionFromEnv({
      COLLECTION_MODE: "DIRECT_SELLER",
      PAYMENT_ACCOUNTS_KEY_1: key(),
      PAYMENT_ACCOUNTS_KEY_2: key(),
      PAYMENT_ACCOUNTS_KEY_VERSION: "2",
    });
    const credentials = {
      apiUser: "user",
      apiKey: "très-secret",
      webhookSecret: "wh",
    };
    const { sealed, keyVersion } = sealCredentials(credentials, settings);
    expect(keyVersion).toBe(2);
    expect(sealed.toString("latin1")).not.toContain("très-secret");
    expect(openCredentials(sealed, 2, settings)).toEqual(credentials);
    // Mauvaise clé ou contenu altéré : refus (authentification GCM).
    expect(() => openCredentials(sealed, 1, settings)).toThrow();
    const tampered = Buffer.from(sealed);
    tampered.writeUInt8(
      tampered.readUInt8(tampered.length - 1) ^ 1,
      tampered.length - 1,
    );
    expect(() => openCredentials(tampered, 2, settings)).toThrow();
  });

  it("builds a seller adapter, never the simulator in production", () => {
    const fapshi = providerForAccount(
      "fapshi",
      "SANDBOX",
      { apiUser: "u", apiKey: "k", webhookSecret: "s" },
      {},
    );
    expect(fapshi.capabilities.has("perMerchantCredentials")).toBe(true);
    expect(() =>
      providerForAccount(
        "mock",
        "MOCK",
        { secret: "s".repeat(32) },
        {
          NODE_ENV: "production",
          PAYMENTS_MOCK_ENABLED: "true",
        },
      ),
    ).toThrow(/disabled/);
    expect(() => providerForAccount("cinetpay", "SANDBOX", {}, {})).toThrow(
      /No merchant account/,
    );
  });
});
