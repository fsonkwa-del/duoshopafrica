"use server";
import { isLocale } from "@duoshop/i18n";
import { type LegalKind, recordConsent } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

// Accepte les versions affichées (et seulement celles-là : la version est envoyée par le formulaire).
export async function acceptTermsAction(form: FormData) {
  const raw = String(form.get("locale"));
  const locale = isLocale(raw) ? raw : "fr";
  const token = await sessionToken();
  if (!token) redirect(`/${locale}/account`);
  let failed = false;
  for (const value of form.getAll("doc")) {
    const [kind, version] = String(value).split(":");
    const result = await recordConsent(apiUrl, token, webOrigin, {
      kind: kind as LegalKind,
      version: Number(version),
      granted: true,
      source: "update",
    });
    if (!result.ok) failed = true;
  }
  redirect(`/${locale}/account/consent?${failed ? "error=1" : "accepted=1"}`);
}
