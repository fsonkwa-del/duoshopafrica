import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getCommissionRules } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { closeRuleAction, createRuleAction } from "./actions";

// Valeur par défaut d'un champ datetime-local : maintenant + 5 min, heure de Douala.
const doualaInput = (offsetMs: number) =>
  new Date(Date.now() + 3600_000 + offsetMs).toISOString().slice(0, 16);

export default async function Commissions({
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
  const c = t.commissions;
  const path = "/admin/commissions";
  const token = await sessionToken();
  const result = token ? await getCommissionRules(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const errorText = (code: string | undefined) =>
    code && code in c.errors
      ? c.errors[code as keyof typeof c.errors]
      : c.errors.unknown;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{c.title}</h1>
        <Notice>
          {result.status === 404 ? t.admin.notStaff : errorText(result.error)}
        </Notice>
      </AccountShell>
    );
  const { rules, stores, canConfigure } = result.data;
  const now = Date.now();
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} />
      <h1>{c.title}</h1>
      <p>{c.intro}</p>
      {query.saved && <Notice>{c.saved}</Notice>}
      {query.error && <Notice>{errorText(query.error)}</Notice>}
      {!canConfigure && <Notice>{c.readOnly}</Notice>}
      {rules.length === 0 ? (
        <Notice>{c.none}</Notice>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{c.store}</th>
                <th>{c.rate}</th>
                <th>{c.validFrom}</th>
                <th>{c.validTo}</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id}>
                  <td>
                    {r.storeName ?? c.allStores}
                    <br />
                    <span className="meta">{r.label}</span>
                  </td>
                  <td>{(r.basisPoints / 100).toLocaleString(locale)} %</td>
                  <td>{formatDateTime(r.validFrom, locale)}</td>
                  <td>
                    {r.validTo ? (
                      formatDateTime(r.validTo, locale)
                    ) : canConfigure &&
                      Date.parse(r.validFrom) < now + 365 * 86400_000 ? (
                      <form action={closeRuleAction} className="stack">
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="ruleId" value={r.id} />
                        <input
                          type="datetime-local"
                          name="validTo"
                          defaultValue={doualaInput(5 * 60_000)}
                          aria-label={c.validTo}
                          required
                        />
                        <button type="submit" className="link-button">
                          {c.close}
                        </button>
                      </form>
                    ) : (
                      c.open
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canConfigure && (
        <section className="panel" aria-labelledby="new-rule">
          <h2 id="new-rule">{c.add}</h2>
          <form action={createRuleAction} className="stack">
            <input type="hidden" name="locale" value={locale} />
            <label>
              {c.store}
              <select name="storeId" defaultValue="">
                <option value="">{c.allStores}</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {c.basisPoints}
              <input
                name="basisPoints"
                type="number"
                min={0}
                max={10000}
                step={1}
                required
              />
            </label>
            <label>
              {c.label}
              <input name="label" minLength={3} maxLength={120} required />
            </label>
            <label>
              {c.validFrom}
              <input
                type="datetime-local"
                name="validFrom"
                defaultValue={doualaInput(60_000)}
                required
              />
            </label>
            <button type="submit" className="cta">
              {c.add}
            </button>
          </form>
        </section>
      )}
    </AccountShell>
  );
}
