import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getDataRequests } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { dataRequestStepAction } from "./actions";

// Demandes des personnes sur leurs données (lot 2), triées par échéance.
export default async function PrivacyRequests({
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
  const path = "/admin/privacy";
  const token = await sessionToken();
  const result = token ? await getDataRequests(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const errorText = (code: string | undefined) =>
    code && code in a.errors
      ? a.errors[code as keyof typeof a.errors]
      : a.errors.unknown;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{a.requestsTitle}</h1>
        <Notice>
          {result.status === 404 ? t.admin.notStaff : errorText(result.error)}
        </Notice>
      </AccountShell>
    );
  const { requests, canErase } = result.data;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{a.requestsTitle}</h1>
      <p>{a.requestsIntro}</p>
      {query.saved && <Notice>{a.saved}</Notice>}
      {query.error && <Notice>{errorText(query.error)}</Notice>}
      {requests.length === 0 ? (
        <p>{a.none}</p>
      ) : (
        <ul className="stack">
          {requests.map((r) => (
            <li key={r.id} className="panel">
              <p>
                <strong>{p.requestKinds[r.kind]}</strong> —{" "}
                {p.statuses[r.status]}{" "}
                {r.overdue && <span className="badge">{a.overdue}</span>}
                <br />
                <span className="meta">
                  {a.person} {r.userId.slice(0, 8)} · {p.due}{" "}
                  {formatDateTime(r.dueAt, locale)}
                </span>
              </p>
              <p>{r.message}</p>
              <form action={dataRequestStepAction} className="stack">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="requestId" value={r.id} />
                <label>
                  {a.resolution}
                  <textarea name="resolution" maxLength={2000} />
                </label>
                <div className="inline-forms">
                  {r.status === "OPEN" && (
                    <button
                      type="submit"
                      name="action"
                      value="IN_PROGRESS"
                      className="secondary"
                    >
                      {a.start}
                    </button>
                  )}
                  {r.kind !== "ERASURE" && (
                    <button
                      type="submit"
                      name="action"
                      value="DONE"
                      className="secondary"
                    >
                      {a.close}
                    </button>
                  )}
                  {r.kind === "ERASURE" && canErase && (
                    <button
                      type="submit"
                      name="action"
                      value="erase"
                      className="cta"
                    >
                      {a.erase}
                    </button>
                  )}
                  <button
                    type="submit"
                    name="action"
                    value="REJECTED"
                    className="link-button"
                  >
                    {a.reject}
                  </button>
                </div>
              </form>
            </li>
          ))}
        </ul>
      )}
    </AccountShell>
  );
}
