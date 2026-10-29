"use server";
import { isLocale } from "@duoshop/i18n";
import { submitVerification, updateFulfilment } from "@duoshop/sdk";
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
  const result = await submitVerification(apiUrl, token, webOrigin, storeId, {
    legalName: String(formData.get("legalName") ?? "").trim(),
    ...(registrationNumber ? { registrationNumber } : {}),
  });
  redirect(`${back}?verification=${result.ok ? "submitted" : "failed"}`);
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
