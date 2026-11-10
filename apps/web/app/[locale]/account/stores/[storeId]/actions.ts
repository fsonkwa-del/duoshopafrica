"use server";
import { isLocale } from "@duoshop/i18n";
import {
  savePaymentAccount,
  submitVerification,
  updateFulfilment,
  updateStoreContact,
  updateZoneFees,
} from "@duoshop/sdk";
import type { BusinessTypeDTO, StoreZoneFeeDTO } from "@duoshop/types";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../../lib/session";

export async function sendVerification(formData: FormData) {
  const locale = String(formData.get("locale"));
  const storeId = String(formData.get("storeId"));
  const back = `/${isLocale(locale) ? locale : "fr"}/account/stores/${encodeURIComponent(storeId)}`;
  const token = await sessionToken();
  if (!token) redirect(back);
  const registrationNumber = String(
    formData.get("registrationNumber") ?? "",
  ).trim();
  const text = (name: string) => String(formData.get(name) ?? "").trim();
  const result = await submitVerification(apiUrl, token, webOrigin, storeId, {
    businessType: text("businessType") as BusinessTypeDTO,
    ownerName: text("ownerName"),
    ownerPhone: text("ownerPhone"),
    city: text("city"),
    district: text("district"),
    legalName: text("legalName"),
    ...(registrationNumber ? { registrationNumber } : {}),
  });
  redirect(
    `${back}?verification=${result.ok ? "submitted" : result.error === "invalid_phone" ? "invalid_phone" : "failed"}`,
  );
}

export async function saveFulfilment(formData: FormData) {
  const locale = String(formData.get("locale"));
  const storeId = String(formData.get("storeId"));
  const back = `/${isLocale(locale) ? locale : "fr"}/account/stores/${encodeURIComponent(storeId)}`;
  const token = await sessionToken();
  if (!token) redirect(back);
  const fee = String(formData.get("deliveryFeeMinor") ?? "").trim();
  const instructions = String(formData.get("pickupInstructions") ?? "").trim();
  const result = await updateFulfilment(apiUrl, token, webOrigin, storeId, {
    deliveryFeeMinor: fee === "" ? null : fee,
    pickupEnabled: formData.get("pickupEnabled") === "on",
    ...(instructions ? { pickupInstructions: instructions } : {}),
    expectedVersion: Number(formData.get("expectedVersion")),
  });
  redirect(
    `${back}?verification=${result.ok ? "fulfilment_saved" : "fulfilment_failed"}`,
  );
}

// Contact public de la boutique (mentions légales, ADR 0015).
export async function saveContact(formData: FormData) {
  const locale = String(formData.get("locale"));
  const storeId = String(formData.get("storeId"));
  const back = `/${isLocale(locale) ? locale : "fr"}/account/stores/${encodeURIComponent(storeId)}`;
  const token = await sessionToken();
  if (!token) redirect(back);
  const phone = String(formData.get("contactPhone") ?? "").trim();
  const email = String(formData.get("contactEmail") ?? "").trim();
  const result = await updateStoreContact(apiUrl, token, webOrigin, storeId, {
    phone: phone || null,
    email: email || null,
  });
  redirect(
    `${back}?verification=${result.ok ? "contact_saved" : "contact_failed"}`,
  );
}

// Tarifs par quartier : champ vide = tarif « toutes zones » ; case cochée = non desservi.
export async function saveZoneFees(formData: FormData) {
  const locale = String(formData.get("locale"));
  const storeId = String(formData.get("storeId"));
  const back = `/${isLocale(locale) ? locale : "fr"}/account/stores/${encodeURIComponent(storeId)}`;
  const token = await sessionToken();
  if (!token) redirect(back);
  const zoneIds = new Set<string>();
  for (const key of formData.keys()) {
    const match = /^(fee|off)_([0-9a-f-]{36})$/.exec(key);
    if (match?.[2]) zoneIds.add(match[2]);
  }
  const fees = [...zoneIds].flatMap((zoneId): StoreZoneFeeDTO[] => {
    if (formData.get(`off_${zoneId}`) === "on")
      return [{ zoneId, feeMinor: null }];
    const fee = String(formData.get(`fee_${zoneId}`) ?? "").trim();
    return fee ? [{ zoneId, feeMinor: fee }] : [];
  });
  const result = await updateZoneFees(apiUrl, token, webOrigin, storeId, fees);
  redirect(
    `${back}?verification=${result.ok ? "zones_saved" : "zones_failed"}`,
  );
}

// Compte marchand (mode direct, lot 3). L'adresse de notification revient dans l'URL : ce n'est
// pas un secret (le secret reste chez le prestataire et chiffré en base).
export async function savePaymentAccountAction(formData: FormData) {
  const locale = String(formData.get("locale"));
  const storeId = String(formData.get("storeId"));
  const back = `/${isLocale(locale) ? locale : "fr"}/account/stores/${encodeURIComponent(storeId)}`;
  const token = await sessionToken();
  if (!token) redirect(back);
  const credentials: Record<string, string> = {};
  for (const [key, value] of formData.entries())
    if (key.startsWith("cred_")) credentials[key.slice(5)] = String(value);
  const result = await savePaymentAccount(apiUrl, token, webOrigin, storeId, {
    provider: String(formData.get("provider")),
    mode: String(formData.get("mode")),
    credentials,
  });
  redirect(
    result.ok
      ? `${back}?verification=account_saved&notify=${encodeURIComponent(result.data.notifyUrl)}`
      : `${back}?verification=account_failed`,
  );
}
