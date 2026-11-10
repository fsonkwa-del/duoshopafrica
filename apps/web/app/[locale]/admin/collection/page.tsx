import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getCollectionAuthorizations } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import {
  approveAuthorizationAction,
  requestAuthorizationAction,
} from "./actions";

// Mode d'encaissement en service et autorisations du mode « plateforme détentrice » (lot 3).
export default async function Collection({
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
  const c = t.collection;
  const path = "/admin/collection";
  const token = await sessionToken();
  const result = token
    ? await getCollectionAuthorizations(apiUrl, token)
    : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const errorText = (code: string | undefined) =>
    code && code in c.errors
      ? c.errors[code as keyof typeof c.errors]
      : c.errors.unknown;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{c.adminTitle}</h1>
        <Notice>
          {result.status === 404 ? t.admin.notStaff : errorText(result.error)}
        </Notice>
      </AccountShell>
    );
  const { mode, role, authorizations } = result.data;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{c.adminTitle}</h1>
      <p>
        {c.current} : <strong>{c.modeNames[mode]}</strong>
      </p>
      <p className="hint">{c.adminIntro}</p>
      {query.saved && <Notice>{t.privacy.admin.saved}</Notice>}
      {query.error && <Notice>{errorText(query.error)}</Notice>}
      {authorizations.length > 0 && (
        <ul className="stack">
          {authorizations.map((a) => (
            <li key={a.id} className="panel">
              <strong>
                {c.modeNames[a.mode as keyof typeof c.modeNames] ?? a.mode}
              </strong>{" "}
              — {a.agrementReference}
              <br />
              <span className="meta">
                {c.expiresAt} {formatDateTime(a.expiresAt, locale)} ·{" "}
                {a.revokedAt
                  ? c.revoked
                  : a.approvedAt
                    ? c.approved
                    : c.pending}
              </span>
              {!a.approvedAt && !a.revokedAt && role === "FINANCE" && (
                <form action={approveAuthorizationAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="id" value={a.id} />
                  <button type="submit" className="secondary">
                    {c.approve}
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
      {role === "ADMIN" && (
        <section className="panel" aria-labelledby="request">
          <h2 id="request">{c.request}</h2>
          <form action={requestAuthorizationAction} className="stack">
            <input type="hidden" name="locale" value={locale} />
            <label>
              {c.current}
              <select name="mode" defaultValue="PLATFORM_HELD">
                <option value="PLATFORM_HELD">
                  {c.modeNames.PLATFORM_HELD}
                </option>
                <option value="PSP_ESCROW">{c.modeNames.PSP_ESCROW}</option>
              </select>
            </label>
            <label>
              {c.reference}
              <input name="reference" minLength={5} maxLength={200} required />
            </label>
            <label>
              {c.expiresAt}
              <input name="expiresAt" type="date" required />
            </label>
            <button type="submit" className="cta">
              {c.request}
            </button>
          </form>
        </section>
      )}
    </AccountShell>
  );
}
