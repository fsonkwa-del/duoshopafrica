"use server";
import { isLocale } from "@duoshop/i18n";
import { archiveAddress, createAddress } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

const fields = [
  "label",
  "recipientName",
  "phone",
  "city",
  "district",
  "landmark",
  "details",
];

function page(form: FormData) {
  const raw = String(form.get("locale"));
  return `/${isLocale(raw) ? raw : "fr"}/account/addresses`;
}

export async function createAddressAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const body: Record<string, string> = {};
  for (const name of fields) {
    const value = String(form.get(name) ?? "").trim();
    if (value) body[name] = value;
  }
  // Le numéro est normalisé par l'API (formats locaux acceptés) ; pas de GPS saisi ici.
  const result = await createAddress(apiUrl, token, webOrigin, body);
  redirect(`${back}?${result.ok ? "saved=1" : "error=1"}`);
}

export async function archiveAddressAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  await archiveAddress(
    apiUrl,
    token,
    webOrigin,
    String(form.get("addressId") ?? ""),
  );
  redirect(back);
}
