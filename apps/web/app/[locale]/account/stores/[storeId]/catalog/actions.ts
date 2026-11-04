"use server";
import { isLocale } from "@duoshop/i18n";
import {
  type ApiResult,
  changeMedia,
  changePrice,
  changeProductStatus,
  createProduct,
  moveStock,
  requestMediaUpload,
  setProductCategory,
} from "@duoshop/sdk";
import type { ProductStatusDTO } from "@duoshop/types";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../../../lib/session";

const field = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();

async function context(form: FormData) {
  const locale = field(form, "locale");
  const storeId = field(form, "storeId");
  const page = `/${isLocale(locale) ? locale : "fr"}/account/stores/${encodeURIComponent(storeId)}/catalog`;
  const token = await sessionToken();
  if (!token) redirect(page);
  return { page, storeId, token };
}
function finish(page: string, result: ApiResult<unknown>, ok: string): never {
  redirect(
    result.ok
      ? `${page}?ok=${ok}`
      : `${page}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );
}

export async function createProductAction(form: FormData) {
  const { page, storeId, token } = await context(form);
  const variants = [0, 1, 2]
    .map((i) => ({
      sku: field(form, `sku_${i}`),
      label: field(form, `label_${i}`),
      priceMinor: field(form, `price_${i}`),
    }))
    .filter((v) => v.sku || v.label || v.priceMinor);
  const description = field(form, "description");
  const categoryId = field(form, "categoryId");
  const result = await createProduct(apiUrl, token, webOrigin, storeId, {
    title: field(form, "title"),
    ...(description ? { description } : {}),
    ...(categoryId ? { categoryId } : {}),
    variants,
  });
  finish(page, result, "created");
}

export async function changeStatusAction(form: FormData) {
  const { page, storeId, token } = await context(form);
  const result = await changeProductStatus(
    apiUrl,
    token,
    webOrigin,
    storeId,
    field(form, "productId"),
    {
      status: field(form, "status") as ProductStatusDTO,
      expectedVersion: Number(field(form, "expectedVersion")),
    },
  );
  finish(page, result, "saved");
}

export async function changePriceAction(form: FormData) {
  const { page, storeId, token } = await context(form);
  const result = await changePrice(
    apiUrl,
    token,
    webOrigin,
    storeId,
    field(form, "variantId"),
    {
      priceMinor: field(form, "priceMinor"),
      expectedVersion: Number(field(form, "expectedVersion")),
    },
  );
  finish(page, result, "saved");
}

export async function moveStockAction(form: FormData) {
  const { page, storeId, token } = await context(form);
  const quantity = Number(field(form, "quantity"));
  const receipt = field(form, "mode") === "receive";
  // Entier non nul uniquement ; l'API revérifie tout (bornes, stock réservé).
  if (!Number.isInteger(quantity) || quantity === 0)
    redirect(`${page}?error=invalid_request`);
  const result = await moveStock(
    apiUrl,
    token,
    webOrigin,
    storeId,
    field(form, "variantId"),
    {
      delta: receipt ? Math.abs(quantity) : quantity,
      reason: receipt ? "RECEIPT" : "ADJUSTMENT",
      idempotencyKey: field(form, "idempotencyKey"),
    },
  );
  finish(
    page,
    result,
    result.ok && result.data.replayed ? "replayed" : "saved",
  );
}

// Appelée par le composant client : renvoie l'URL présignée, le fichier part ensuite
// directement du navigateur vers le stockage (ADR 0006), jamais via nos serveurs.
export async function requestPhotoUpload(input: {
  storeId: string;
  productId: string;
  contentType: string;
  bytes: number;
  altFr: string;
  altEn: string;
}): Promise<
  | { ok: true; url: string; headers: Record<string, string> }
  | { ok: false; error: string }
> {
  const token = await sessionToken();
  if (!token) return { ok: false, error: "unauthenticated" };
  const { storeId, productId, ...body } = input;
  const result = await requestMediaUpload(
    apiUrl,
    token,
    webOrigin,
    storeId,
    productId,
    body,
  );
  return result.ok
    ? {
        ok: true,
        url: result.data.upload.url,
        headers: result.data.upload.headers,
      }
    : { ok: false, error: result.error ?? "unknown" };
}

export async function changeCategoryAction(form: FormData) {
  const { page, storeId, token } = await context(form);
  const categoryId = field(form, "categoryId");
  const result = await setProductCategory(
    apiUrl,
    token,
    webOrigin,
    storeId,
    field(form, "productId"),
    categoryId || null,
  );
  finish(page, result, "category");
}

export async function changeMediaAction(form: FormData) {
  const { page, storeId, token } = await context(form);
  const action = field(form, "action") === "primary" ? "primary" : "remove";
  const result = await changeMedia(
    apiUrl,
    token,
    webOrigin,
    storeId,
    field(form, "productId"),
    field(form, "mediaId"),
    action,
  );
  finish(page, result, action === "primary" ? "photoPrimary" : "photoRemoved");
}
