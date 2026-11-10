import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getParameters } from "@duoshop/sdk";
import type { ParameterValueDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { decideParameterAction, proposeParameterAction } from "./actions";

// Valeur par défaut d'un champ datetime-local : maintenant + 10 min, heure de Douala.
const doualaInput = () =>
  new Date(Date.now() + 3600_000 + 10 * 60_000).toISOString().slice(0, 16);

export default async function Parameters({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; decided?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const p = t.parameters;
  const path = "/admin/parameters";
  const token = await sessionToken();
  const result = token ? await getParameters(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const errorText = (code: string | undefined) =>
    code && code in p.errors
      ? p.errors[code as keyof typeof p.errors]
      : p.errors.unknown;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{p.title}</h1>
        <Notice>
          {result.status === 404 ? t.admin.notStaff : errorText(result.error)}
        </Notice>
      </AccountShell>
    );
  const { definitions, pending, history } = result.data;
  const label = (key: string) => {
    const d = definitions.find((x) => x.key === key);
    return d ? (locale === "fr" ? d.labelFr : d.labelEn) : key;
  };
  const period = (v: ParameterValueDTO) =>
    `${p.since} ${formatDateTime(v.effectiveFrom, locale)}${
      v.effectiveTo
        ? ` ${p.until} ${formatDateTime(v.effectiveTo, locale)}`
        : ""
    }`;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{p.title}</h1>
      <p>{p.intro}</p>
      <p className="meta">{p.notice}</p>
      {query.saved && <Notice>{p.saved}</Notice>}
      {query.decided && <Notice>{p.decided}</Notice>}
      {query.error && <Notice>{errorText(query.error)}</Notice>}

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{t.parameters.title}</th>
              <th>{p.current}</th>
              <th>{p.basis}</th>
            </tr>
          </thead>
          <tbody>
            {definitions.map((d) => (
              <tr key={d.key}>
                <td>
                  {locale === "fr" ? d.labelFr : d.labelEn}
                  <br />
                  <span className="meta">
                    {d.key} · {p.owner} {d.ownerRole}
                    {d.minValue || d.maxValue
                      ? ` · ${p.bounds} ${d.minValue ?? "…"} – ${d.maxValue ?? "…"}`
                      : ""}
                  </span>
                </td>
                <td>
                  {d.current ? (
                    <>
                      <strong>{d.current.value}</strong>
                      <br />
                      <span className="meta">
                        {period(d.current)} ·{" "}
                        {p.status[d.current.validationStatus]}
                      </span>
                    </>
                  ) : (
                    p.none
                  )}
                </td>
                <td>{d.current?.legalBasis ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="panel" aria-labelledby="pending">
        <h2 id="pending">{p.pendingTitle}</h2>
        {pending.length === 0 ? (
          <p>{p.pendingNone}</p>
        ) : (
          <ul className="stack">
            {pending.map((v) => (
              <li key={v.id} className="panel">
                <p>
                  <strong>{label(v.key)}</strong> : {v.value}
                  <br />
                  <span className="meta">
                    {period(v)} · {p.status[v.validationStatus]} · {p.proposed}{" "}
                    {formatDateTime(v.proposedAt, locale)}
                  </span>
                </p>
                {v.legalBasis && (
                  <p className="meta">
                    {p.basis} : {v.legalBasis}
                  </p>
                )}
                {v.proposedByMe ? (
                  <p className="meta">{p.yours}</p>
                ) : (
                  <form action={decideParameterAction} className="stack">
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="parameterId" value={v.id} />
                    <label>
                      {p.reason}
                      <input name="reason" maxLength={500} />
                    </label>
                    <div className="actions">
                      <button
                        type="submit"
                        name="decision"
                        value="approve"
                        className="cta"
                      >
                        {p.approve}
                      </button>
                      <button
                        type="submit"
                        name="decision"
                        value="reject"
                        className="link-button"
                      >
                        {p.reject}
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {definitions.some((d) => d.canPropose) && (
        <section className="panel" aria-labelledby="propose">
          <h2 id="propose">{p.propose}</h2>
          <form action={proposeParameterAction} className="stack">
            <input type="hidden" name="locale" value={locale} />
            <label>
              {p.title}
              <select name="key" required>
                {definitions
                  .filter((d) => d.canPropose)
                  .map((d) => (
                    <option key={d.key} value={d.key}>
                      {locale === "fr" ? d.labelFr : d.labelEn}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              {p.value}
              <input name="value" maxLength={2000} required />
              <span className="meta">{p.valueHint}</span>
            </label>
            <label>
              {p.effectiveFrom}
              <input
                type="datetime-local"
                name="effectiveFrom"
                defaultValue={doualaInput()}
                required
              />
            </label>
            <label>
              {p.legalBasis}
              <input name="legalBasis" maxLength={500} />
            </label>
            <label className="variant-choice">
              <input type="checkbox" name="validated" />
              {p.validated}
            </label>
            <button type="submit" className="cta">
              {p.submit}
            </button>
          </form>
        </section>
      )}

      {history.length > 0 && (
        <section aria-labelledby="history">
          <h2 id="history">{p.historyTitle}</h2>
          <ul>
            {history.map((v) => (
              <li key={v.id}>
                <strong>{label(v.key)}</strong> : {v.value} — {period(v)} ·{" "}
                {v.approvedAt ? p.approved : p.rejected}
                {v.rejectReason ? ` (${v.rejectReason})` : ""} ·{" "}
                {p.status[v.validationStatus]}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AccountShell>
  );
}
