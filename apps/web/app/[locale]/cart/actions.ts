"use server";
import { isLocale } from "@duoshop/i18n";
import { setCartLine } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, ensureShopper, webOrigin } from "../../../lib/session";

// Retour uniquement vers une page interne de la même langue (jamais une URL fournie telle quelle).
function safeBack(locale: string, back: string): string {
  return back.startsWith(`/${locale}/`) &&
    !back.includes("//") &&
    !back.includes("\\")
    ? (back.split("?")[0] ?? `/${locale}/cart`)
    : `/${locale}/cart`;
}

export async function setLineAction(form: FormData) {
  const raw = String(form.get("locale"));
  const locale = isLocale(raw) ? raw : "fr";
  const back = safeBack(locale, String(form.get("back") ?? ""));
  // Pas de compte exigé pour remplir son panier : il sera demandé au moment de commander.
  const credentials = await ensureShopper();
  const quantity = Number(form.get("quantity"));
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 99)
    redirect(`${back}?error=invalid_request`);
  const result = await setCartLine(apiUrl, credentials, webOrigin, {
    variantId: String(form.get("variantId") ?? ""),
    quantity,
  });
  redirect(
    result.ok
      ? `${back}?ok=${quantity === 0 ? "removed" : "added"}`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}
