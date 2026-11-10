import {
  formatDateTime,
  formatMoney,
  type Locale,
  messages,
} from "@duoshop/i18n";
import type { CommissionInvoiceDTO } from "@duoshop/types";
import type { ReactNode } from "react";

// Factures et avoirs de commission (lot 4) : liste commune finance et vendeur, PDF servi par l'API.
export function InvoiceList({
  locale,
  invoices,
  pdfHref,
  action,
}: {
  locale: Locale;
  invoices: CommissionInvoiceDTO[];
  pdfHref: (invoice: CommissionInvoiceDTO) => string;
  action?: (invoice: CommissionInvoiceDTO) => ReactNode;
}) {
  const a = messages[locale].accounting;
  if (invoices.length === 0) return <p>{a.none}</p>;
  const money = (m: { amountMinor: string; currency: string }) =>
    formatMoney(BigInt(m.amountMinor), m.currency, locale);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>N°</th>
            <th>{a.period}</th>
            <th>{a.ttc}</th>
            <th>{a.due}</th>
            <th>PDF</th>
          </tr>
        </thead>
        <tbody>
          {invoices.map((i) => (
            <tr key={i.id}>
              <td>
                {a.kinds[i.kind]} {i.number}
                <br />
                <span className="meta">{i.storeName}</span>
              </td>
              <td>
                {i.periodStart} – {i.periodEnd}
              </td>
              <td>
                {money(i.totalTtc)}
                <br />
                <span className="meta">
                  {a.ht} {money(i.totalHt)} · {a.vat} {money(i.vat)}
                </span>
              </td>
              <td>
                {i.kind === "INVOICE"
                  ? i.paidAt
                    ? `${a.paid} (${i.paidReference ?? ""})`
                    : `${a.unpaid} — ${formatDateTime(i.dueAt, locale)}`
                  : "—"}
                {action?.(i)}
              </td>
              <td>
                <a href={pdfHref(i)}>{a.pdf}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
