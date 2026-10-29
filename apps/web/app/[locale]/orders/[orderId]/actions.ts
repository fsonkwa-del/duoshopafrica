"use server";
import { isLocale } from "@duoshop/i18n";
import {
  claimAction,
  openClaim,
  simulatePayment,
  startPayment,
} from "@duoshop/sdk";
import type { ClaimReasonDTO } from "@duoshop/types";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

function target(form: FormData) {
  const raw = String(form.get("locale"));
  const locale = isLocale(raw) ? raw : "fr";
  const orderId = String(form.get("orderId") ?? "");
  return {
    locale,
    page: `/${locale}/orders/${encodeURIComponent(orderId)}`,
    orderId,
  };
}

export async function payAction(form: FormData) {
  const { locale, page, orderId } = target(form);
  const token = await sessionToken();
  if (!token)
    redirect(
      `/v1/auth/login?${new URLSearchParams({ returnTo: page, locale })}`,
    );
  const phone = String(form.get("payerPhone") ?? "").trim();
  const result = await startPayment(apiUrl, token, webOrigin, orderId, {
    methodCode: String(form.get("methodCode") ?? ""),
    idempotencyKey: String(form.get("idempotencyKey") ?? ""),
    ...(phone ? { payerPhone: phone } : {}),
  });
  // Le statut affiché ensuite est relu sur le serveur : ce retour n'est jamais une preuve.
  redirect(
    result.ok
      ? page
      : `${page}?payError=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}

export async function simulateAction(form: FormData) {
  const { page } = target(form);
  const token = await sessionToken();
  if (!token) redirect(page);
  const outcome = form.get("outcome") === "SUCCEEDED" ? "SUCCEEDED" : "FAILED";
  const result = await simulatePayment(
    apiUrl,
    token,
    webOrigin,
    String(form.get("paymentId") ?? ""),
    outcome,
  );
  redirect(
    result.ok
      ? page
      : `${page}?payError=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}

const reasons: readonly string[] = [
  "DAMAGED",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "MISSING_ITEM",
  "OTHER",
];

// Réclamation : quantités saisies par article (champ q_<id>), seules les quantités > 0 comptent.
export async function openClaimAction(form: FormData) {
  const { locale, page, orderId } = target(form);
  const token = await sessionToken();
  if (!token) redirect(page);
  const sellerOrderId = String(form.get("sellerOrderId") ?? "");
  const items = [...form.entries()].flatMap(([name, value]) => {
    const quantity = Number(value);
    return name.startsWith("q_") && Number.isInteger(quantity) && quantity > 0
      ? [{ orderItemId: name.slice(2), quantity }]
      : [];
  });
  const reason = String(form.get("reason") ?? "");
  const back = `/${locale}/orders/${encodeURIComponent(orderId)}/claim?seller=${encodeURIComponent(sellerOrderId)}`;
  if (items.length === 0 || !reasons.includes(reason))
    redirect(`${back}&error=invalid_items`);
  const result = await openClaim(apiUrl, token, webOrigin, orderId, {
    sellerOrderId,
    reason: reason as ClaimReasonDTO,
    description: String(form.get("description") ?? "").trim(),
    items,
    idempotencyKey: String(form.get("idempotencyKey") ?? ""),
  });
  redirect(
    result.ok
      ? `${page}?claimSent=1`
      : `${back}&error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}

export async function claimStepAction(form: FormData) {
  const { page } = target(form);
  const token = await sessionToken();
  if (!token) redirect(page);
  const action = form.get("action") === "escalate" ? "escalate" : "withdraw";
  const result = await claimAction(
    apiUrl,
    token,
    webOrigin,
    String(form.get("claimId") ?? ""),
    action,
  );
  redirect(
    result.ok
      ? page
      : `${page}?claimError=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}
