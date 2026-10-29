import { describe, expect, it } from "vitest";
import { formatDateTime, formatMoney, isLocale, messages } from "./index";

describe("localisation", () => {
  it("keeps the same keys in both languages, at every level", () => {
    const shape = (value: unknown): unknown =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, shape(child)]),
          )
        : typeof value;
    expect(shape(messages.fr)).toEqual(shape(messages.en));
  });
  it("shows timestamps in the Douala business time zone", () =>
    expect(formatDateTime("2026-10-28T23:30:00Z", "en")).toContain("29"));
  it("formats XAF without fractional units and EUR with cents", () => {
    expect(formatMoney(5000n, "XAF", "fr")).toContain("5");
    expect(formatMoney(5000n, "XAF", "en")).toContain("5,000");
    expect(formatMoney(1234n, "EUR", "en")).toContain("12.34");
  });
  it("rejects unsupported locales and unsafe display amounts", () => {
    expect(isLocale("ar")).toBe(false);
    expect(() => formatMoney(10n ** 20n, "XAF", "fr")).toThrow();
  });
});
