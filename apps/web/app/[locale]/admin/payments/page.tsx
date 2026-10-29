import { formatDateTime, formatMoney, isLocale, messages } from "@duoshop/i18n";
import { getAdminPayments } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { staffError } from "../../../../lib/staff";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";

export default async function PaymentsToHandle({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const a = t.admin;
  const p = a.payments;
  const path = "/admin/payments";
  const token = await sessionToken();
  const result = token ? await getAdminPayments(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{p.title}</h1>
        <Notice>
          {result.status === 404
            ? a.notStaff
            : staffError(locale, result.error)}
        </Notice>
      </AccountShell>
    );
  const { payments, events, refunds } = result.data;
  const reason = (code: string | null) =>
    code && code in p.reasons
      ? p.reasons[code as keyof typeof p.reasons]
      : code;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} />
      <h1>{p.title}</h1>
      <p>{p.intro}</p>
      {payments.length === 0 ? (
        <p>{p.empty}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{a.date}</th>
                <th>{t.orders.number}</th>
                <th>{t.payment.choose}</th>
                <th>{t.checkout.total}</th>
                <th>{a.action}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((x) => (
                <tr key={x.id}>
                  <td>{formatDateTime(x.settledAt ?? x.createdAt, locale)}</td>
                  <td>{x.orderId.slice(0, 8).toUpperCase()}</td>
                  <td>
                    {x.methodCode} · {x.provider}
                    {x.mode !== "LIVE" ? " · TEST" : ""}
                    <br />
                    {x.providerReference}
                  </td>
                  <td>
                    {formatMoney(
                      BigInt(x.amount.amountMinor),
                      x.amount.currency,
                      locale,
                    )}{" "}
                    · {t.payment.statuses[x.status]}
                  </td>
                  <td>{reason(x.attentionReason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>{p.refunds}</h2>
      {refunds.length === 0 ? (
        <p>{p.empty}</p>
      ) : (
        <ul className="cart-lines">
          {refunds.map((r) => (
            <li key={r.id}>
              <span>
                {t.orders.number} {r.orderId.slice(0, 8).toUpperCase()} ·{" "}
                {formatDateTime(r.createdAt, locale)}
              </span>
              <strong>
                {formatMoney(
                  BigInt(r.amount.amountMinor),
                  r.amount.currency,
                  locale,
                )}
              </strong>
            </li>
          ))}
        </ul>
      )}
      <h2>{p.events}</h2>
      {events.length === 0 ? (
        <p>{p.empty}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{a.date}</th>
                <th>{a.methods.provider}</th>
                <th>ID</th>
                <th>{t.checkout.total}</th>
                <th>{a.action}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>{formatDateTime(e.receivedAt, locale)}</td>
                  <td>{e.provider}</td>
                  <td>
                    {e.eventId} · {e.reportedStatus}
                  </td>
                  <td>
                    {formatMoney(
                      BigInt(e.amount.amountMinor),
                      e.amount.currency,
                      locale,
                    )}
                  </td>
                  <td>
                    {e.outcome} · {reason(e.detail)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AccountShell>
  );
}
