"use server";
import { isLocale } from "@duoshop/i18n";
import { decideVerification, revealOwnerContact } from "@duoshop/sdk";
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

// Affichage motivé du contact privé du propriétaire (journalisé côté API, lot 2).
export async function revealOwnerAction(
  _previous: unknown,
  form: FormData,
): Promise<
  | { ok: true; ownerName: string | null; ownerPhone: string | null }
  | { ok: false; error: string }
> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "unauthenticated" };
  const result = await revealOwnerContact(
    apiUrl,
    token,
    webOrigin,
    String(form.get("storeId")),
    String(form.get("reason") ?? "").trim(),
  );
  return result.ok
    ? { ok: true, ...result.data }
    : { ok: false, error: result.error ?? "unknown" };
}
