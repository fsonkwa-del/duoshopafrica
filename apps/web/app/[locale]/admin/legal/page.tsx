import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getLegalDocuments } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { publishLegalAction } from "./actions";

// Valeur par défaut du champ datetime-local : maintenant + 10 min, heure de Douala.
const doualaInput = () =>
  new Date(Date.now() + 3600_000 + 10 * 60_000).toISOString().slice(0, 16);

// Documents légaux (lot 2) : textes du juriste, publiés par version, immuables.
export default async function LegalDocuments({
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
  const p = t.privacy;
  const a = p.admin;
  const path = "/admin/legal";
  const token = await sessionToken();
  const result = token ? await getLegalDocuments(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const errorText = (code: string | undefined) =>
    code && code in a.errors
      ? a.errors[code as keyof typeof a.errors]
      : a.errors.unknown;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{a.legalTitle}</h1>
        <Notice>
          {result.status === 404 ? t.admin.notStaff : errorText(result.error)}
        </Notice>
      </AccountShell>
    );
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{a.legalTitle}</h1>
      <p>{a.legalIntro}</p>
      {query.saved && <Notice>{a.published}</Notice>}
      {query.error && <Notice>{errorText(query.error)}</Notice>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{a.kind}</th>
              <th>{a.title}</th>
              <th>{a.effectiveFrom}</th>
            </tr>
          </thead>
          <tbody>
            {result.data.documents.map((d) => (
              <tr key={d.id}>
                <td>
                  {p.kinds[d.kind]} · {p.version} {d.version} · {d.locale}
                </td>
                <td>
                  {d.title}
                  <br />
                  <span className="meta">SHA-256 {d.sha256.slice(0, 12)}…</span>
                </td>
                <td>{formatDateTime(d.effectiveFrom, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="panel" aria-labelledby="publish">
        <h2 id="publish">{a.publish}</h2>
        <form action={publishLegalAction} className="stack">
          <input type="hidden" name="locale" value={locale} />
          <label>
            {a.kind}
            <select name="kind">
              {(["CGU", "CGV", "PRIVACY", "MARKETING"] as const).map((k) => (
                <option key={k} value={k}>
                  {p.kinds[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {p.version}
            <input
              name="version"
              type="number"
              min={1}
              defaultValue={1}
              required
            />
          </label>
          <label>
            {a.locale}
            <select name="docLocale" defaultValue={locale}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          <label>
            {a.title}
            <input name="title" minLength={3} maxLength={200} required />
          </label>
          <label>
            {a.body}
            <textarea name="body" minLength={20} rows={12} required />
          </label>
          <label>
            {a.effectiveFrom}
            <input
              type="datetime-local"
              name="effectiveFrom"
              defaultValue={doualaInput()}
              required
            />
          </label>
          <button type="submit" className="cta">
            {a.publish}
          </button>
        </form>
      </section>
    </AccountShell>
  );
}
