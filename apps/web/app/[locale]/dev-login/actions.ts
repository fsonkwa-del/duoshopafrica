"use server";
import { isLocale } from "@duoshop/i18n";
import { SESSION_COOKIE } from "@duoshop/types";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { apiUrl, sessionCookie, webOrigin } from "../../../lib/session";

const profiles: readonly string[] = ["newBuyer", "buyer", "seller", "admin"];

// DEV UNIQUEMENT : l'API refuse (404) si DEV_LOGIN_ENABLED n'est pas actif.
export async function demoSignIn(form: FormData) {
  const raw = String(form.get("locale"));
  const locale = isLocale(raw) ? raw : "fr";
  const profile = String(form.get("profile"));
  const returnTo = String(form.get("returnTo") ?? "");
  const page = `/${locale}/dev-login`;
  if (process.env.NODE_ENV === "production" || !profiles.includes(profile))
    redirect(`${page}?error=1`);
  const response = await fetch(new URL("/v1/dev/sessions", apiUrl), {
    method: "POST",
    cache: "no-store",
    headers: { origin: webOrigin, "content-type": "application/json" },
    body: JSON.stringify({ profile }),
  });
  if (!response.ok) redirect(`${page}?error=1`);
  const { token } = (await response.json()) as { token: string };
  (await cookies()).set(SESSION_COOKIE, token, {
    ...sessionCookie,
    maxAge: 12 * 3600,
  });
  const fallback =
    profile === "seller"
      ? `/${locale}/account`
      : profile === "admin"
        ? `/${locale}/admin/verifications`
        : `/${locale}/products`;
  // Retour interne uniquement (même règle que la connexion OIDC).
  redirect(
    /^\/(fr|en)(\/[A-Za-z0-9\-._~/]*)?$/.test(returnTo) &&
      !returnTo.includes("//") &&
      !returnTo.endsWith("/account")
      ? returnTo
      : fallback,
  );
}
