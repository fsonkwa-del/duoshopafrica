"use server";
import { isLocale } from "@duoshop/i18n";
import { markInvoicePaid, saveLedgerMapping } from "@duoshop/sdk";
import { redirect } from "next/navigation";
import { apiUrl, sessionToken, webOrigin } from "../../../../lib/session";

const localeOf = (form: FormData) => {
  const raw = String(form.get("locale"));
  return isLocale(raw) ? raw : "fr";
};
const done = (back: string, result: { ok: boolean; error?: string }) =>
  redirect(
    result.ok
      ? `${back}?saved=1`
      : `${back}?error=${encodeURIComponent(result.error ?? "unknown")}`,
  );

export async function markPaidAction(form: FormData) {
  const back = `/${localeOf(form)}/admin/invoices`;
  const token = await sessionToken();
  if (!token) redirect(back);
  done(
    back,
    await markInvoicePaid(
      apiUrl,
      token,
      webOrigin,
      String(form.get("invoiceId")),
      String(form.get("reference") ?? "").trim(),
    ),
  );
}

export async function saveMappingAction(form: FormData) {
  const back = `/${localeOf(form)}/admin/ledger-mapping`;
  const token = await sessionToken();
  if (!token) redirect(back);
  done(
    back,
    await saveLedgerMapping(apiUrl, token, webOrigin, {
      account: String(form.get("account")),
      accountNumber: String(form.get("accountNumber") ?? "").trim(),
      label: String(form.get("label") ?? "").trim(),
      effectiveFrom: String(form.get("effectiveFrom") ?? ""),
      validated: form.get("validated") === "on",
    }),
  );
}
