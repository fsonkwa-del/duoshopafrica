"use server";
import { isLocale } from "@duoshop/i18n";
import { createZone, updateZone } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

function page(form: FormData) {
  const raw = String(form.get("locale"));
  return `/${isLocale(raw) ? raw : "fr"}/admin/zones`;
}
const done = (back: string, result: { ok: boolean; error?: string }) =>
  redirect(
    result.ok
      ? `${back}?saved=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );

export async function createZoneAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const position = Number(form.get("position") ?? "");
  done(
    back,
    await createZone(apiUrl, token, webOrigin, {
      slug: String(form.get("slug") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      name: String(form.get("name") ?? "").trim(),
      ...(Number.isInteger(position) && position >= 0 ? { position } : {}),
    }),
  );
}

export async function toggleZoneAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  done(
    back,
    await updateZone(apiUrl, token, webOrigin, String(form.get("zoneId")), {
      active: form.get("active") === "true",
    }),
  );
}
