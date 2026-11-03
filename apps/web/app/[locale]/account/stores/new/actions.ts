"use server";
import { isLocale } from "@duoshop/i18n";
import { openStore } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../../lib/session";

export async function openStoreAction(formData: FormData) {
  const raw = String(formData.get("locale"));
  const locale = isLocale(raw) ? raw : "fr";
  const back = `/${locale}/account/stores/new`;
  const token = await sessionToken();
  if (!token) redirect(back);
  const result = await openStore(apiUrl, token, webOrigin, {
    name: String(formData.get("name") ?? "").trim(),
    slug: String(formData.get("slug") ?? "")
      .trim()
      .toLowerCase(),
  });
  if (result.ok)
    redirect(
      `/${locale}/account/stores/${encodeURIComponent(result.data.id)}?verification=opened`,
    );
  redirect(`${back}?error=${encodeURIComponent(result.error ?? "unknown")}`);
}
