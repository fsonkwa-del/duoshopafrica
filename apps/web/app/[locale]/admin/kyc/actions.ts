"use server";
import { isLocale } from "@duoshop/i18n";
import { reviewKyc } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

export async function reviewKycAction(form: FormData) {
  const raw = String(form.get("locale"));
  const back = `/${isLocale(raw) ? raw : "fr"}/admin/kyc`;
  const token = await sessionToken();
  if (!token) redirect(back);
  const reason = String(form.get("reason") ?? "").trim();
  const result = await reviewKyc(
    apiUrl,
    token,
    webOrigin,
    String(form.get("storeId")),
    {
      approve: form.get("decision") === "approve",
      ...(reason ? { reason } : {}),
    },
  );
  redirect(
    result.ok
      ? `${back}?saved=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}
