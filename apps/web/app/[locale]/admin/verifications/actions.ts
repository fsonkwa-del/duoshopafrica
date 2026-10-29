"use server";
import { isLocale } from "@duoshop/i18n";
import { decideVerification } from "@duoshop/sdk";
import type { MerchantDecisionDTO } from "@duoshop/types";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

const decisions: readonly string[] = [
  "APPROVE",
  "REJECT",
  "SUSPEND",
  "REINSTATE",
];

export async function decide(formData: FormData) {
  const locale = String(formData.get("locale"));
  const status = String(formData.get("status"));
  const decision = String(formData.get("decision"));
  const queue = `/${isLocale(locale) ? locale : "fr"}/admin/verifications?status=${encodeURIComponent(status)}`;
  const token = await sessionToken();
  if (!token || !decisions.includes(decision)) redirect(queue);
  const result = await decideVerification(
    apiUrl,
    token,
    webOrigin,
    String(formData.get("storeId")),
    {
      decision: decision as MerchantDecisionDTO,
      reason: String(formData.get("reason") ?? "").trim(),
      expectedVersion: Number(formData.get("expectedVersion")),
    },
  );
  redirect(
    result.ok
      ? `${queue}&result=done`
      : `${queue}&error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}
