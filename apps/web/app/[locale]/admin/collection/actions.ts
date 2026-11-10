"use server";
import { isLocale } from "@duoshop/i18n";
import {
  approveCollectionAuthorization,
  requestCollectionAuthorization,
} from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

function page(form: FormData) {
  const raw = String(form.get("locale"));
  return `/${isLocale(raw) ? raw : "fr"}/admin/collection`;
}
const done = (back: string, result: { ok: boolean; error?: string }) =>
  redirect(
    result.ok
      ? `${back}?saved=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );

export async function requestAuthorizationAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const until = String(form.get("expiresAt") ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until))
    redirect(`${back}?error=authorization_expired`);
  done(
    back,
    await requestCollectionAuthorization(apiUrl, token, webOrigin, {
      mode: String(form.get("mode")),
      agrementReference: String(form.get("reference") ?? "").trim(),
      // Fin de journée à l'heure de Douala (UTC+1).
      expiresAt: new Date(`${until}T23:59:00+01:00`).toISOString(),
    }),
  );
}

export async function approveAuthorizationAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  done(
    back,
    await approveCollectionAuthorization(
      apiUrl,
      token,
      webOrigin,
      String(form.get("id")),
    ),
  );
}
