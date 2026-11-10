"use server";
import { isLocale } from "@duoshop/i18n";
import { decideParameter, proposeParameter } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

function page(form: FormData) {
  const raw = String(form.get("locale"));
  return `/${isLocale(raw) ? raw : "fr"}/admin/parameters`;
}
// Champ datetime-local saisi à l'heure de Douala (UTC+1, sans heure d'été).
function doualaInstant(value: string): string {
  return new Date(`${value}:00+01:00`).toISOString();
}

export async function proposeParameterAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const from = String(form.get("effectiveFrom") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(from))
    redirect(`${back}?error=invalid_request`);
  const legalBasis = String(form.get("legalBasis") ?? "").trim();
  const result = await proposeParameter(apiUrl, token, webOrigin, {
    key: String(form.get("key") ?? ""),
    value: String(form.get("value") ?? "").trim(),
    effectiveFrom: doualaInstant(from),
    ...(legalBasis ? { legalBasis } : {}),
    validated: form.get("validated") === "on",
  });
  redirect(
    result.ok
      ? `${back}?saved=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}

export async function decideParameterAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const reason = String(form.get("reason") ?? "").trim();
  const result = await decideParameter(
    apiUrl,
    token,
    webOrigin,
    String(form.get("parameterId") ?? ""),
    {
      approve: form.get("decision") === "approve",
      ...(reason ? { reason } : {}),
    },
  );
  redirect(
    result.ok
      ? `${back}?decided=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}
