import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getStoreAudit } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../../../lib/session";
import { staffError } from "../../../../../../lib/staff";
import { AccountShell, SignIn } from "../../../../account/account-shell";

interface DecisionDetail {
  from?: string;
  to?: string;
  reason?: string;
}

export default async function StoreAudit({
  params,
}: {
  params: Promise<{ locale: string; storeId: string }>;
}) {
  const { locale, storeId } = await params;
  if (!isLocale(locale)) notFound();
  const a = messages[locale].admin;
  const path = `/admin/stores/${storeId}/audit`;
  const token = await sessionToken();
  const audit = token ? await getStoreAudit(apiUrl, token, storeId) : null;
  if (!audit || (!audit.ok && audit.status === 401))
    return <SignIn locale={locale} path={path} />;
  const back = (
    <p>
      <Link href={`/${locale}/admin/verifications`}>{a.back}</Link>
    </p>
  );
  if (!audit.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        {back}
        <h1>{a.audit}</h1>
        <Notice>
          {audit.status === 404 ? a.notStaff : staffError(locale, audit.error)}
        </Notice>
      </AccountShell>
    );
  return (
    <AccountShell locale={locale} path={path} signedIn>
      {back}
      <h1>{a.audit}</h1>
      {audit.data.entries.length === 0 ? (
        <p>{a.auditEmpty}</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">{a.date}</th>
                <th scope="col">{a.action}</th>
                <th scope="col">{a.actor}</th>
                <th scope="col">{messages[locale].verification.reason}</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.entries.map((entry) => {
                const detail = (entry.detail ?? {}) as DecisionDetail;
                return (
                  <tr key={`${entry.requestId}-${entry.action}`}>
                    <td>{formatDateTime(entry.createdAt, locale)}</td>
                    <td>
                      {entry.action}
                      {detail.from && detail.to
                        ? ` (${detail.from} → ${detail.to})`
                        : ""}
                    </td>
                    <td>
                      <code>{entry.actorId.slice(0, 8)}</code>
                    </td>
                    <td>{detail.reason ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AccountShell>
  );
}
