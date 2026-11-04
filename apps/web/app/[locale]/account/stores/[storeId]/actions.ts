"use server";
import { isLocale } from "@duoshop/i18n";
import { submitVerification, updateFulfilment } from "@duoshop/sdk";
import type { BusinessTypeDTO } from "@duoshop/types";
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
