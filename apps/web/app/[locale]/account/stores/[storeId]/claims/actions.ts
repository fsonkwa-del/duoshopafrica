"use server";
import { isLocale } from "@duoshop/i18n";
import { respondClaim } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../../../lib/session";

export async function respondClaimAction(form: FormData) {
  const raw = String(form.get("locale"));
  const locale = isLocale(raw) ? raw : "fr";
  const storeId = String(form.get("storeId") ?? "");
  const claimId = String(form.get("claimId") ?? "");
  const page = `/${locale}/account/stores/${encodeURIComponent(storeId)}/claims`;
  const token = await sessionToken();
  if (!token) redirect(page);
  const note = String(form.get("note") ?? "").trim();
  const result = await respondClaim(
    apiUrl,
    token,
    webOrigin,
    storeId,
    claimId,
    {
      accept: form.get("decision") === "accept",
      expectedVersion: Number(form.get("expectedVersion")),
      ...(note ? { note } : {}),
    },
  );
  const anchor = `#c-${encodeURIComponent(claimId)}`;
  redirect(
    result.ok
      ? `${page}?done=1${anchor}`
      : `${page}?error=${encodeURIComponent(result.error ?? "unknown")}${anchor}`,
  );
}
