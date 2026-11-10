"use server";
import { isLocale } from "@duoshop/i18n";
import { openDataRequest, recordConsent } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

function page(form: FormData) {
  const raw = String(form.get("locale"));
  return `/${isLocale(raw) ? raw : "fr"}/account/data`;
}

export async function marketingAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const result = await recordConsent(apiUrl, token, webOrigin, {
    kind: "MARKETING",
    version: Number(form.get("version")),
    granted: form.get("granted") === "true",
    source: "account",
  });
  redirect(`${back}?${result.ok ? "saved=1" : "error=unknown"}`);
}

export async function dataRequestAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const result = await openDataRequest(apiUrl, token, webOrigin, {
    kind: String(form.get("kind") ?? "OTHER"),
    message: String(form.get("message") ?? "").trim(),
  });
  redirect(`${back}?${result.ok ? "sent=1" : "error=invalid_request"}`);
}
