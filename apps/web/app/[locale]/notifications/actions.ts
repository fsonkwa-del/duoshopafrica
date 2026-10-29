"use server";
import { isLocale } from "@duoshop/i18n";
import { markNotificationsRead } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../lib/session";

export async function markReadAction(form: FormData) {
  const raw = String(form.get("locale"));
  const page = `/${isLocale(raw) ? raw : "fr"}/notifications`;
  const token = await sessionToken();
  if (token) await markNotificationsRead(apiUrl, token, webOrigin);
  redirect(page);
}
