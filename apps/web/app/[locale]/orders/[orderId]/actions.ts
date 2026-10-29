"use server";
import { isLocale } from "@duoshop/i18n";
import { simulatePayment, startPayment } from "@duoshop/sdk";
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
