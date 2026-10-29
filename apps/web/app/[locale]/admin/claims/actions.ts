"use server";
import { isLocale } from "@duoshop/i18n";
import { decideClaim } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

export async function decideClaimAction(form: FormData) {
  const raw = String(form.get("locale"));
  const page = `/${isLocale(raw) ? raw : "fr"}/admin/claims`;
  const token = await sessionToken();
  if (!token) redirect(page);
  const result = await decideClaim(
    apiUrl,
    token,
    webOrigin,
    String(form.get("claimId") ?? ""),
    {
      refund: form.get("decision") === "refund",
      note: String(form.get("note") ?? "").trim(),
    },
  );
  redirect(
    result.ok
      ? `${page}?done=1`
      : `${page}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}
