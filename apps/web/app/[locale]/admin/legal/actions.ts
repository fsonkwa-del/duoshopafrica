"use server";
import { isLocale } from "@duoshop/i18n";
import { type LegalKind, publishLegalDocument } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

export async function publishLegalAction(form: FormData) {
  const raw = String(form.get("locale"));
  const back = `/${isLocale(raw) ? raw : "fr"}/admin/legal`;
  const token = await sessionToken();
  if (!token) redirect(back);
  const from = String(form.get("effectiveFrom") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(from))
    redirect(`${back}?error=invalid_request`);
  const result = await publishLegalDocument(apiUrl, token, webOrigin, {
    kind: String(form.get("kind")) as LegalKind,
    version: Number(form.get("version")),
    locale: String(form.get("docLocale")),
    title: String(form.get("title") ?? "").trim(),
    body: String(form.get("body") ?? ""),
    // Saisie à l'heure de Douala (UTC+1, sans heure d'été).
    effectiveFrom: new Date(`${from}:00+01:00`).toISOString(),
  });
  redirect(
    result.ok
      ? `${back}?saved=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}
