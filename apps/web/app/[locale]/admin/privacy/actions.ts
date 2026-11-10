"use server";
import { isLocale } from "@duoshop/i18n";
import { eraseDataRequest, updateDataRequest } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

function page(form: FormData) {
  const raw = String(form.get("locale"));
  return `/${isLocale(raw) ? raw : "fr"}/admin/privacy`;
}
const done = (back: string, result: { ok: boolean; error?: string }) =>
  redirect(
    result.ok
      ? `${back}?saved=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );

export async function dataRequestStepAction(form: FormData) {
  const back = page(form);
  const token = await sessionToken();
  if (!token) redirect(back);
  const id = String(form.get("requestId"));
  const action = String(form.get("action"));
  const resolution = String(form.get("resolution") ?? "").trim();
  if (action === "erase")
    done(
      back,
      await eraseDataRequest(apiUrl, token, webOrigin, id, resolution),
    );
  done(
    back,
    await updateDataRequest(apiUrl, token, webOrigin, id, {
      status: action,
      ...(resolution ? { resolution } : {}),
    }),
  );
}
