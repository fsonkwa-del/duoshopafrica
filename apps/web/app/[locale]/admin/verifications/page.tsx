import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getVerificationQueue } from "@duoshop/sdk";
import type { VerificationStatusDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { staffError } from "../../../../lib/staff";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { decide } from "./actions";

const statuses: readonly VerificationStatusDTO[] = [
  "SUBMITTED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
  "PENDING",
];

export default async function Verifications({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; result?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const status = statuses.find((s) => s === query.status) ?? "SUBMITTED";
  const t = messages[locale];
  const a = t.admin;
  const path = "/admin/verifications";
  const token = await sessionToken();
  const queue = token
    ? await getVerificationQueue(apiUrl, token, status)
    : null;
  if (!queue || (!queue.ok && queue.status === 401))
    return <SignIn locale={locale} path={path} />;
  if (!queue.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{a.title}</h1>
        <Notice>
          {queue.status === 404 ? a.notStaff : staffError(locale, queue.error)}
        </Notice>
      </AccountShell>
    );
  const decisions =
    status === "SUBMITTED"
      ? (["APPROVE", "REJECT"] as const)
      : status === "APPROVED"
        ? (["SUSPEND"] as const)
        : status === "SUSPENDED"
          ? (["REINSTATE"] as const)
          : [];
  return (
    <AccountShell locale={locale} path={`${path}?status=${status}`} signedIn>
      <AdminNav locale={locale} />
      <h1>{a.title}</h1>
      <form className="filters" method="get">
        <label>
          {a.filter}
          <select name="status" defaultValue={status}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {t.verification.statuses[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="link-button">
          {a.show}
        </button>
      </form>
      {query.result === "done" && <Notice>{a.done}</Notice>}
      {query.error && <Notice>{staffError(locale, query.error)}</Notice>}
      {queue.data.items.length === 0 ? (
        <p>{a.empty}</p>
      ) : (
        <ul className="queue">
          {queue.data.items.map((item) => (
            <li key={item.storeId} className="panel">
              <h2>{item.storeName}</h2>
              <dl className="facts">
                <dt>{a.legalName}</dt>
                <dd>{item.legalName ?? "—"}</dd>
                <dt>{a.registrationNumber}</dt>
                <dd>{item.registrationNumber ?? "—"}</dd>
                <dt>{a.submittedAt}</dt>
                <dd>
                  {item.submittedAt
                    ? formatDateTime(item.submittedAt, locale)
                    : "—"}
                </dd>
              </dl>
              <p>
                <Link href={`/${locale}/admin/stores/${item.storeId}/audit`}>
                  {a.audit}
                </Link>
              </p>
              {decisions.length > 0 && (
                <form action={decide} className="stack">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="status" value={status} />
                  <input type="hidden" name="storeId" value={item.storeId} />
                  <input
                    type="hidden"
                    name="expectedVersion"
                    value={item.version}
                  />
                  <label>
                    {a.reason}
                    <textarea
                      name="reason"
                      required
                      minLength={10}
                      maxLength={1000}
                      rows={3}
                    />
                  </label>
                  <div className="actions">
                    {decisions.map((decision) => (
                      <button
                        key={decision}
                        type="submit"
                        name="decision"
                        value={decision}
                        className={decision === "APPROVE" ? "cta" : "secondary"}
                      >
                        {decision === "APPROVE"
                          ? a.approve
                          : decision === "REJECT"
                            ? a.reject
                            : decision === "SUSPEND"
                              ? a.suspend
                              : a.reinstate}
                      </button>
                    ))}
                  </div>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </AccountShell>
  );
}
