import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getAccessLog } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";

// Journal des consultations de données sensibles par le personnel (lot 2).
export default async function AccessLog({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const a = t.privacy.admin;
  const path = "/admin/access-log";
  const token = await sessionToken();
  const result = token ? await getAccessLog(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{a.accessTitle}</h1>
        <Notice>
          {result.status === 404
            ? t.admin.notStaff
            : result.error && result.error in a.errors
              ? a.errors[result.error as keyof typeof a.errors]
              : a.errors.unknown}
        </Notice>
      </AccountShell>
    );
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{a.accessTitle}</h1>
      <p>{a.accessIntro}</p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>{a.actor}</th>
              <th>{a.resource}</th>
              <th>{a.reason}</th>
            </tr>
          </thead>
          <tbody>
            {result.data.entries.map((e) => (
              <tr key={e.id}>
                <td>{formatDateTime(e.createdAt, locale)}</td>
                <td>{e.actorId.slice(0, 8)}</td>
                <td>
                  {e.resource} · {e.resourceId.slice(0, 8)}
                </td>
                <td>{e.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AccountShell>
  );
}
