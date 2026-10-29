import { formatMoney, isLocale, type Locale, messages } from "@duoshop/i18n";
import { getFinanceReport } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { staffError } from "../../../../lib/staff";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";

const amount = (value: string, currency: string, locale: Locale) =>
  formatMoney(BigInt(value), currency, locale);
const isDay = (v: string | undefined) => v && /^\d{4}-\d{2}-\d{2}$/.test(v);

export default async function Finance({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const fi = t.finance;
  const path = "/admin/finance";
  const token = await sessionToken();
  const result = token
    ? await getFinanceReport(apiUrl, token, {
        ...(isDay(query.from) ? { from: query.from } : {}),
        ...(isDay(query.to) ? { to: query.to } : {}),
      })
    : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <AdminNav locale={locale} />
        <h1>{fi.title}</h1>
        <Notice>
          {result.status === 404
            ? t.admin.notStaff
            : result.error === "invalid_period"
              ? fi.invalidPeriod
              : staffError(locale, result.error)}
        </Notice>
      </AccountShell>
    );
  const r = result.data;
  const accountLabel = (a: string) =>
    a in fi.accounts ? fi.accounts[a as keyof typeof fi.accounts] : a;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} />
      <h1>{fi.title}</h1>
      <p>{fi.intro}</p>
      <form method="get" className="filters">
        <label>
          {fi.from}
          <input type="date" name="from" defaultValue={r.from} />
        </label>
        <label>
          {fi.to}
          <input type="date" name="to" defaultValue={r.to} />
        </label>
        <button type="submit" className="link-button">
          {fi.show}
        </button>
      </form>

      <section aria-labelledby="anomalies" className="panel">
        <h2 id="anomalies">{fi.anomalies}</h2>
        {r.anomalies.length === 0 ? (
          <p>{fi.noAnomaly}</p>
        ) : (
          <ul className="cart-lines">
            {r.anomalies.map((a) => (
              <li key={`${a.kind}-${a.reference}`}>
                <span>
                  <strong>{fi.kinds[a.kind]}</strong>
                  <br />
                  <span className="meta">{a.reference}</span>
                </span>
                {a.expected !== null && (
                  <span>
                    {fi.expected} {a.expected} · {fi.posted} {a.posted}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <h2>{fi.balances}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{fi.account}</th>
              <th>{fi.amount}</th>
            </tr>
          </thead>
          <tbody>
            {r.balances.map((b) => (
              <tr key={`${b.account}-${b.currency}`}>
                <td>{accountLabel(b.account)}</td>
                <td>{amount(b.amount, b.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{fi.payables}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{fi.store}</th>
              <th>{fi.amount}</th>
            </tr>
          </thead>
          <tbody>
            {r.payables.map((p) => (
              <tr key={`${p.tenantId}-${p.currency}`}>
                <td>{p.stores ?? p.tenantId}</td>
                <td>{amount(p.amount, p.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>{fi.holds}</h2>
      {r.holds.length === 0 ? (
        <p>{fi.noHold}</p>
      ) : (
        <ul className="cart-lines">
          {r.holds.map((h) => (
            <li key={`${h.tenantId}-${h.currency}`}>
              <span>{h.stores ?? h.tenantId}</span>
              <strong>{amount(h.amount, h.currency, locale)}</strong>
            </li>
          ))}
        </ul>
      )}

      <h2>{fi.daily}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{fi.day}</th>
              <th>{fi.settled}</th>
              <th>{fi.posted}</th>
            </tr>
          </thead>
          <tbody>
            {r.daily.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td>{amount(d.settled, "XAF", locale)}</td>
                <td>{amount(d.posted, "XAF", locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AccountShell>
  );
}
