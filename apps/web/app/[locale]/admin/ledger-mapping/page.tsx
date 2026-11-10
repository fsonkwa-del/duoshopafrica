import { isLocale, messages } from "@duoshop/i18n";
import { getLedgerMapping } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { saveMappingAction } from "../invoices/actions";

// Correspondance des comptes internes avec le plan SYSCOHADA (lot 4) : saisie par la finance.
export default async function LedgerMapping({
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
  const path = "/admin/ledger-mapping";
  const token = await sessionToken();
  const result = token ? await getLedgerMapping(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{a.mappingTitle}</h1>
        <Notice>
          {result.status === 404 ? t.admin.notStaff : a.errors.unknown}
        </Notice>
      </AccountShell>
    );
  const { accounts, mappings, canConfigure } = result.data;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{a.mappingTitle}</h1>
      <p>{a.mappingIntro}</p>
      {query.saved && <Notice>{a.saved}</Notice>}
      {query.error && <Notice>{a.errors.unknown}</Notice>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{a.account}</th>
              <th>{a.accountNumber}</th>
              <th>{a.effectiveFrom}</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((account) => {
              const current = mappings.find((m) => m.account === account);
              return (
                <tr key={account}>
                  <td>{account}</td>
                  <td>
                    {current
                      ? `${current.accountNumber} — ${current.label}`
                      : a.notMapped}
                    {current && (
                      <span className="meta">
                        {" "}
                        · {t.parameters.status[current.validationStatus]}
                      </span>
                    )}
                  </td>
                  <td>{current?.effectiveFrom ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canConfigure && (
        <section className="panel" aria-labelledby="map">
          <h2 id="map">{a.save}</h2>
          <form action={saveMappingAction} className="stack">
            <input type="hidden" name="locale" value={locale} />
            <label>
              {a.account}
              <select name="account">
                {accounts.map((account) => (
                  <option key={account} value={account}>
                    {account}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {a.accountNumber}
              <input name="accountNumber" pattern="[0-9]{2,12}" required />
            </label>
            <label>
              {a.label}
              <input name="label" minLength={2} maxLength={160} required />
            </label>
            <label>
              {a.effectiveFrom}
              <input name="effectiveFrom" type="date" required />
            </label>
            <label className="variant-choice">
              <input type="checkbox" name="validated" />
              {a.validated}
            </label>
            <button type="submit" className="cta">
              {a.save}
            </button>
          </form>
        </section>
      )}
    </AccountShell>
  );
}
