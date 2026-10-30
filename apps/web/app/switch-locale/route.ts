import { isLocale } from "@duoshop/i18n";
import { type NextRequest, NextResponse } from "next/server";

// Sélecteur langue/devise (formulaire GET, sans JavaScript) : renvoie vers la même page dans la
// langue choisie. Seuls les chemins internes sont acceptés (pas de redirection ouverte).
// Devise : XAF uniquement (seule devise réellement gérée par la plateforme).
export function GET(request: NextRequest) {
  const lang = request.nextUrl.searchParams.get("lang") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const locale = isLocale(lang) ? lang : "fr";
  const path =
    /^\/[A-Za-z0-9\-._~/?=&%]*$/.test(to) && !to.startsWith("//") ? to : "";
  return NextResponse.redirect(new URL(`/${locale}${path}`, request.url), 303);
}
