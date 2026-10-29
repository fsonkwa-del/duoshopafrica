"use server";
import { isLocale } from "@duoshop/i18n";
import { closeCommissionRule, createCommissionRule } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

function page(form: FormData) {
  const raw = String(form.get("locale"));
  return `/${isLocale(raw) ? raw : "fr"}/admin/commissions`;
}
// Champ datetime-local saisi à l'heure de Douala (UTC+1, sans heure d'été).
function doualaInstant(value: string): string {
  return new Date(`${value}:00+01:00`).toISOString();
}
const done = (back: string, result: { ok: boolean; error?: string }) =>
  redirect(
    result.ok
      ? `${back}?saved=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );

export async function createRuleAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const from = String(form.get("validFrom") ?? "");
  const storeId = String(form.get("storeId") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(from))
    redirect(`${back}?error=invalid_request`);
  done(
    back,
    await createCommissionRule(apiUrl, token, webOrigin, {
      ...(storeId ? { storeId } : {}),
      basisPoints: Number(form.get("basisPoints")),
      label: String(form.get("label") ?? "").trim(),
      validFrom: doualaInstant(from),
    }),
  );
}

export async function closeRuleAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const to = String(form.get("validTo") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(to))
    redirect(`${back}?error=invalid_request`);
  done(
    back,
    await closeCommissionRule(
      apiUrl,
      token,
      webOrigin,
      String(form.get("ruleId") ?? ""),
      doualaInstant(to),
    ),
  );
}
