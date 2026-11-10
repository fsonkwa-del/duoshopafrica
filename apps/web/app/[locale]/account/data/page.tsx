import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getMyPrivacy } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../account-shell";
import { dataRequestAction, marketingAction } from "./actions";

// « Mes données » (lot 2, ADR 0010) : export, préférences commerciales, demandes suivies.
export default async function MyData({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ saved?: string; sent?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const p = messages[locale].privacy;
  const path = "/account/data";
  const token = await sessionToken();
  const result = token ? await getMyPrivacy(apiUrl, token) : null;
  if (!result?.ok) return <SignIn locale={locale} path={path} />;
  const { marketing, consents, requests } = result.data;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <h1>{p.dataTitle}</h1>
      <p>{p.dataIntro}</p>
      {query.saved && <Notice>{p.admin.saved}</Notice>}
      {query.sent && <Notice>{p.requestSent}</Notice>}
      {query.error && <Notice>{p.admin.errors.invalid_request}</Notice>}
      <p className="inline-forms">
        {/* Liens pleins : téléchargement servi par l'API sous la même origine. */}
        <a className="secondary" href={`/v1/me/export?lang=${locale}`}>
          {p.exportJson}
        </a>{" "}
        <a className="secondary" href={`/v1/me/export.pdf?lang=${locale}`}>
          {p.exportPdf}
        </a>
      </p>

      <section className="panel" aria-labelledby="marketing">
        <h2 id="marketing">{p.marketingTitle}</h2>
        {marketing.version === null ? (
          <p>{p.marketingNone}</p>
        ) : (
          <form action={marketingAction}>
            <p>{marketing.granted ? p.marketingOn : p.marketingOff}</p>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="version" value={marketing.version} />
            <input
              type="hidden"
              name="granted"
              value={marketing.granted ? "false" : "true"}
            />
            <button type="submit" className="secondary">
              {marketing.granted ? p.marketingWithdraw : p.marketingAccept}
            </button>
          </form>
        )}
      </section>

      <section className="panel" aria-labelledby="request">
        <h2 id="request">{p.requestTitle}</h2>
        <p className="hint">{p.erasureNote}</p>
        <form action={dataRequestAction} className="stack">
          <input type="hidden" name="locale" value={locale} />
          <label>
            {p.requestKind}
            <select name="kind" defaultValue="RECTIFICATION">
              {(["RECTIFICATION", "ERASURE", "OTHER"] as const).map((k) => (
                <option key={k} value={k}>
                  {p.requestKinds[k]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {p.requestMessage}
            <textarea name="message" minLength={10} maxLength={2000} required />
          </label>
          <button type="submit" className="cta">
            {p.requestSubmit}
          </button>
        </form>
      </section>

      {requests.length > 0 && (
        <section aria-labelledby="requests">
          <h2 id="requests">{p.requestsTitle}</h2>
          <ul>
            {requests.map((r) => (
              <li key={r.id}>
                <strong>{p.requestKinds[r.kind]}</strong> —{" "}
                {p.statuses[r.status]}
                {r.closedAt
                  ? ""
                  : ` · ${p.due} ${formatDateTime(r.dueAt, locale)}`}
                {r.resolution && <p className="meta">{r.resolution}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {consents.length > 0 && (
        <section aria-labelledby="consents">
          <h2 id="consents">{p.historyTitle}</h2>
          <ul>
            {consents.map((c) => (
              <li key={`${c.kind}-${c.createdAt}`}>
                {p.kinds[c.kind]} ({p.version} {c.version}) —{" "}
                {c.granted ? p.granted : p.withdrawn} ·{" "}
                {formatDateTime(c.createdAt, locale)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </AccountShell>
  );
}
