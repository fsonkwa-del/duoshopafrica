"use server";
import { isLocale } from "@duoshop/i18n";
import {
  createPaymentMethod,
  type PaymentMethodInput,
  updatePaymentMethod,
} from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

const kinds: readonly string[] = [
  "MOBILE_MONEY",
  "CARD",
  "BANK_TRANSFER",
  "WALLET",
];
const field = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();

// Formulaire sans JavaScript -> corps JSON strict ; l'API reste seule juge de la validité.
function input(form: FormData): PaymentMethodInput {
  const kind = field(form, "kind");
  return {
    kind: (kinds.includes(kind)
      ? kind
      : "MOBILE_MONEY") as PaymentMethodInput["kind"],
    operator: field(form, "operator").toUpperCase(),
    provider: field(form, "provider").toLowerCase(),
    countryCode: field(form, "countryCode").toUpperCase(),
    currency: field(form, "currency").toUpperCase(),
    labelFr: field(form, "labelFr"),
    labelEn: field(form, "labelEn"),
    instructionsFr: field(form, "instructionsFr"),
    instructionsEn: field(form, "instructionsEn"),
    phonePrefixes: field(form, "phonePrefixes")
      .split(/[\s,;]+/)
      .filter(Boolean),
    minAmountMinor: field(form, "minAmountMinor"),
    maxAmountMinor: field(form, "maxAmountMinor"),
    displayOrder: Number(field(form, "displayOrder") || "100"),
    enabled: form.get("enabled") === "on",
  };
}

export async function saveMethod(form: FormData) {
  const raw = String(form.get("locale"));
  const page = `/${isLocale(raw) ? raw : "fr"}/admin/payment-methods`;
  const token = await sessionToken();
  if (!token) redirect(page);
  const methodId = field(form, "methodId");
  const result = methodId
    ? await updatePaymentMethod(apiUrl, token, webOrigin, methodId, {
        ...input(form),
        expectedVersion: Number(form.get("expectedVersion")),
      })
    : await createPaymentMethod(apiUrl, token, webOrigin, {
        ...input(form),
        code: field(form, "code").toUpperCase(),
      });
  redirect(
    result.ok
      ? `${page}?result=saved`
      : `${page}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}
