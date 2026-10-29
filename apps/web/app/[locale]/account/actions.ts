"use server";
import { isLocale } from "@duoshop/i18n";
import { logout } from "@duoshop/sdk";
import { SESSION_COOKIE } from "@duoshop/types";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  apiUrl,
  sessionCookie,
  sessionToken,
  webOrigin,
} from "../../../lib/session";

export async function signOut(formData: FormData) {
  const locale = String(formData.get("locale"));
  const token = await sessionToken();
  if (token) await logout(apiUrl, token, webOrigin);
  (await cookies()).set(SESSION_COOKIE, "", { ...sessionCookie, maxAge: 0 });
  redirect(`/${isLocale(locale) ? locale : "fr"}`);
}
