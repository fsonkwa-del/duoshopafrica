import { isLocale, messages } from "@duoshop/i18n";
import { getInvoices } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { InvoiceList } from "../../invoice-list";
import { AdminNav } from "../admin-nav";
import { markPaidAction } from "./actions";

// Factures de commission et exports comptables (lot 4, ADR 0012).
export default async function Invoices({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const a = t.accounting;
  const path = "/admin/invoices";
  const token = await sessionToken();
  const result = token ? await getInvoices(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const errorText = (code: string | undefined) =>
    code && code in a.errors
      ? a.errors[code as keyof typeof a.errors]
      : a.errors.unknown;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{a.invoicesTitle}</h1>
        <Notice>
          {result.status === 404 ? t.admin.notStaff : errorText(result.error)}
        </Notice>
      </AccountShell>
    );
  const { invoices, canConfigure } = result.data;
  // Mois en cours par défaut (heure de Douala).
  const today = new Date(Date.now() + 3600_000).toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 8)}01`;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{a.invoicesTitle}</h1>
      <p>{a.invoicesIntro}</p>
      {query.saved && <Notice>{a.saved}</Notice>}
      {query.error && <Notice>{errorText(query.error)}</Notice>}
      <InvoiceList
        locale={locale}
        invoices={invoices}
        pdfHref={(i) => `/v1/admin/invoices/${i.id}/pdf`}
        action={(i) =>
          canConfigure && i.kind === "INVOICE" && !i.paidAt ? (
            <form action={markPaidAction} className="inline-forms">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="invoiceId" value={i.id} />
              <input
                name="reference"
                aria-label={a.reference}
                placeholder={a.reference}
                maxLength={200}
                required
              />
              <button type="submit" className="link-button">
                {a.markPaid}
              </button>
            </form>
          ) : null
        }
      />
      {canConfigure && (
        <section className="panel" aria-labelledby="exports">
          <h2 id="exports">{a.exportsTitle}</h2>
          <p className="hint">{a.exportsIntro}</p>
          {(
            [
              ["ledger", a.ledger],
              ["balance", a.balance],
              ["vat", a.vatJournal],
              ["invoices", a.invoicesCsv],
            ] as const
          ).map(([kind, label]) => (
            <form
              key={kind}
              method="get"
              action={`/v1/admin/exports/${kind}.csv`}
              className="inline-forms"
            >
              <input
                type="date"
                name="from"
                defaultValue={monthStart}
                aria-label={`${label} — ${a.period}`}
                required
              />
              <input
                type="date"
                name="to"
                defaultValue={today}
                aria-label={`${label} — ${a.due}`}
                required
              />
              <button type="submit" className="secondary">
                {label}
              </button>
            </form>
          ))}
        </section>
      )}
      <p>
        <Link href={`/${locale}/admin/ledger-mapping`}>{a.mappingTitle}</Link>
      </p>
    </AccountShell>
  );
}
