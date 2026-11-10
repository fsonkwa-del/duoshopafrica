"use server";
import { isLocale } from "@duoshop/i18n";
import { cancelOrder, createAddress, placeOrder } from "@duoshop/sdk";
import type { DeliveryMethodDTO } from "@duoshop/types";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../lib/session";

const methods: readonly string[] = ["HOME_DELIVERY", "PICKUP"];

function localeOf(form: FormData) {
  const raw = String(form.get("locale"));
  return isLocale(raw) ? raw : "fr";
}

export async function placeOrderAction(form: FormData) {
  const locale = localeOf(form);
  const query = String(form.get("query") ?? "");
  const back = `/${locale}/checkout${query.startsWith("?") ? query : ""}`;
  const token = await sessionToken();
  if (!token)
    redirect(
      `/v1/auth/login?${new URLSearchParams({ returnTo: `/${locale}/checkout`, locale })}`,
    );
  let deliveries: { storeSlug: string; method: DeliveryMethodDTO }[] = [];
  try {
    const parsed = JSON.parse(
      String(form.get("deliveries") ?? "[]"),
    ) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every(
        (d) =>
          typeof d?.storeSlug === "string" &&
          typeof d?.method === "string" &&
          methods.includes(d.method),
      )
    )
      deliveries = parsed;
  } catch {
    deliveries = [];
  }
  const addressId = String(form.get("addressId") ?? "");
  const result = await placeOrder(apiUrl, token, webOrigin, {
    idempotencyKey: String(form.get("idempotencyKey") ?? ""),
    deliveries,
    ...(addressId ? { addressId } : {}),
    expectedTotalMinor: String(form.get("expectedTotalMinor") ?? ""),
    ...(form.get("cgvVersion")
      ? { cgvVersion: Number(form.get("cgvVersion")) }
      : {}),
  });
  if (result.ok) redirect(`/${locale}/orders/${result.data.id}?placed=1`);
  const separator = back.includes("?") ? "&" : "?";
  redirect(
    `${back}${separator}error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}

export async function cancelOrderAction(form: FormData) {
  const locale = localeOf(form);
  const orderId = String(form.get("orderId") ?? "");
  const page = `/${locale}/orders/${encodeURIComponent(orderId)}`;
  const token = await sessionToken();
  if (!token) redirect(page);
  const result = await cancelOrder(apiUrl, token, webOrigin, orderId);
  redirect(
    result.ok
      ? `${page}?cancelled=1`
      : `${page}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}

const addressFields = [
  "label",
  "recipientName",
  "phone",
  "city",
  "district",
  "zoneId",
  "landmark",
  "details",
];

// Adresse saisie pendant le checkout : enregistrée sur le compte puis présélectionnée,
// en conservant les choix de livraison déjà faits.
export async function addAddressAction(form: FormData) {
  const locale = localeOf(form);
  const query = new URLSearchParams(
    String(form.get("query") ?? "").replace(/^\?/, ""),
  );
  query.delete("error");
  const token = await sessionToken();
  if (!token) redirect(`/${locale}/checkout`);
  const body: Record<string, string> = {};
  for (const name of addressFields) {
    const value = String(form.get(name) ?? "").trim();
    if (value) body[name] = value;
  }
  const result = await createAddress(apiUrl, token, webOrigin, body);
  if (result.ok) query.set("address", result.data.id);
  else query.set("error", "address_invalid");
  redirect(`/${locale}/checkout?${query}`);
}
