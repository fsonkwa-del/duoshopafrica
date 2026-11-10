import { formatDateTime, formatMoney, isLocale, messages } from "@duoshop/i18n";
import { getEarnings, getStoreInvoices } from "@duoshop/sdk";
import type { MoneyDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../../../lib/session";
import { SellerNav } from "../../../../admin/admin-nav";
import { InvoiceList } from "../../../../invoice-list";
import { AccountShell, SignIn } from "../../../account-shell";

export default async function Earnings({
  params,
}: {
  params: Promise<{ locale: string; storeId: string }>;
}) {
  const { locale, storeId } = await params;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const e = t.earnings;
  const path = `/account/stores/${storeId}/earnings`;
  const token = await sessionToken();
  const result = token ? await getEarnings(apiUrl, token, storeId) : null;
  // Factures de commission (lot 4) émises chaque mois par la plateforme.
  const invoices = token
    ? await getStoreInvoices(apiUrl, token, storeId)
    : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const back = (
    <p>
      <Link href={`/${locale}/account/stores/${storeId}`}>{t.backToStore}</Link>
    </p>
  );
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        {back}
        <Notice>
          {result.status === 403
            ? t.tracking.errors.forbidden
            : t.storeNotFound}
        </Notice>
      </AccountShell>
    );
  const money = (m: MoneyDTO | null) =>
    m ? formatMoney(BigInt(m.amountMinor), m.currency, locale) : "—";
  const { lines, pending, earned, held } = result.data;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <SellerNav locale={locale} storeId={storeId} current={path} />
      {back}
      <h1>{e.title}</h1>
      <p>{e.intro}</p>
      <dl className="facts">
        <dt>{e.pending}</dt>
        <dd>{money(pending)}</dd>
        <dt>{e.earned}</dt>
        <dd>
          <strong>{money(earned)}</strong>
        </dd>
        <dt>{e.held}</dt>
        <dd>{money(held)}</dd>
      </dl>
      {lines.length === 0 ? (
        <p>{e.empty}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{e.reference}</th>
                <th>{e.gross}</th>
                <th>{e.commission}</th>
                <th>{e.net}</th>
                <th>{e.status}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.sellerOrderId}>
                  <td>
                    {l.reference}
                    <br />
                    <span className="meta">
                      {formatDateTime(l.createdAt, locale)}
                    </span>
                  </td>
                  <td>{money(l.gross)}</td>
                  <td>
                    {money(l.commission)}
                    {l.commissionBasisPoints !== null &&
                      ` (${(l.commissionBasisPoints / 100).toLocaleString(locale)} %)`}
                  </td>
                  <td>
                    <strong>{money(l.net)}</strong>
                    {l.refunded.amountMinor !== "0" && (
                      <>
                        <br />
                        {e.refunded} : −{money(l.refunded)}
                      </>
                    )}
                    {l.onHold && (
                      <>
                        {" "}
                        <span className="badge">{e.onHold}</span>
                      </>
                    )}
                  </td>
                  <td>{t.tracking.statuses[l.fulfilmentStatus]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {invoices?.ok && (
        <section aria-labelledby="invoices">
          <h2 id="invoices">{t.accounting.invoicesTitle}</h2>
          <InvoiceList
            locale={locale}
            invoices={invoices.data.invoices}
            pdfHref={(i) => `/v1/stores/${storeId}/invoices/${i.id}/pdf`}
          />
        </section>
      )}
    </AccountShell>
  );
}
