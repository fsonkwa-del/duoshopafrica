"use server";
import { isLocale } from "@duoshop/i18n";
import { advanceFulfilment } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../../../lib/session";

const steps: readonly string[] = [
  "READY",
  "OUT_FOR_DELIVERY",
  "DELIVERY_FAILED",
  "DELIVERED",
];

export async function advanceAction(form: FormData) {
  const raw = String(form.get("locale"));
  const locale = isLocale(raw) ? raw : "fr";
  const storeId = String(form.get("storeId") ?? "");
  const sellerOrderId = String(form.get("sellerOrderId") ?? "");
  const page = `/${locale}/account/stores/${encodeURIComponent(storeId)}/orders`;
  const token = await sessionToken();
  const to = String(form.get("to") ?? "");
  if (!token || !steps.includes(to)) redirect(page);
  const note = String(form.get("note") ?? "").trim();
  const code = String(form.get("code") ?? "").replace(/\s/g, "");
  const result = await advanceFulfilment(
    apiUrl,
    token,
    webOrigin,
    storeId,
    sellerOrderId,
    {
      to,
      expectedVersion: Number(form.get("expectedVersion")),
      ...(note ? { note } : {}),
      // Format vérifié côté API ; un code mal formé est refusé (400) sans consommer d'essai.
      ...(code ? { code } : {}),
    },
  );
  const anchor = `#o-${encodeURIComponent(sellerOrderId)}`;
  redirect(
    result.ok
      ? `${page}?done=1${anchor}`
      : `${page}?error=${encodeURIComponent(result.status === 400 ? "code_invalid" : (result.error ?? "unknown"))}${anchor}`,
  );
}
