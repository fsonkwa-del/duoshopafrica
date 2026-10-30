"use server";
import { isLocale } from "@duoshop/i18n";
import { createCategory, updateCategory } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

const field = (form: FormData, name: string) =>
  String(form.get(name) ?? "").trim();
function page(form: FormData) {
  const raw = String(form.get("locale"));
  return `/${isLocale(raw) ? raw : "fr"}/admin/categories`;
}
const done = (back: string, result: { ok: boolean; error?: string }) =>
  redirect(
    result.ok
      ? `${back}?saved=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );

export async function createCategoryAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const parentId = field(form, "parentId");
  done(
    back,
    await createCategory(apiUrl, token, webOrigin, {
      slug: field(form, "slug").toLowerCase(),
      nameFr: field(form, "nameFr"),
      nameEn: field(form, "nameEn"),
      position: Number(field(form, "position") || "100"),
      ...(parentId ? { parentId } : {}),
    }),
  );
}

export async function updateCategoryAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  done(
    back,
    await updateCategory(apiUrl, token, webOrigin, field(form, "categoryId"), {
      nameFr: field(form, "nameFr"),
      nameEn: field(form, "nameEn"),
      position: Number(field(form, "position") || "100"),
      active: form.get("active") === "on",
    }),
  );
}
