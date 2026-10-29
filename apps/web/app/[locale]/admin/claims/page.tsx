import { isLocale, messages } from "@duoshop/i18n";
import { listAdminClaims } from "@duoshop/sdk";
import type { ClaimStatusDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { staffError } from "../../../../lib/staff";
import { AccountShell, SignIn } from "../../account/account-shell";
import { ClaimCard } from "../../claim-card";
import { AdminNav } from "../admin-nav";
import { decideClaimAction } from "./actions";

const statuses: readonly ClaimStatusDTO[] = [
  "ESCALATED",
  "OPEN",
  "REJECTED",
  "ACCEPTED",
  "REFUND_APPROVED",
  "CLOSED_NO_REFUND",
  "WITHDRAWN",
];

export default async function AdminClaims({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ status?: string; done?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const c = t.claims;
  const status = statuses.find((s) => s === query.status) ?? "ESCALATED";
  const path = "/admin/claims";
  const token = await sessionToken();
  const result = token ? await listAdminClaims(apiUrl, token, status) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{c.adminTitle}</h1>
        <Notice>
          {result.status === 404
            ? t.admin.notStaff
            : staffError(locale, result.error)}
        </Notice>
      </AccountShell>
    );
  const { claims, canDecide } = result.data;
  return (
    <AccountShell locale={locale} path={`${path}?status=${status}`} signedIn>
      <AdminNav locale={locale} />
      <h1>{c.adminTitle}</h1>
      <form className="filters" method="get">
        <label>
          {t.admin.filter}
          <select name="status" defaultValue={status}>
            {statuses.map((s) => (
              <option key={s} value={s}>
                {c.statuses[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="link-button">
          {t.admin.show}
        </button>
      </form>
      {!canDecide && <Notice>{c.adminReadOnly}</Notice>}
      {query.done && <Notice>{c.done}</Notice>}
      {query.error && (
        <Notice>
          {query.error in c.errors
            ? c.errors[query.error as keyof typeof c.errors]
            : c.errors.unknown}
        </Notice>
      )}
      {claims.length === 0 ? (
        <p>{c.empty}</p>
      ) : (
        claims.map((claim) => (
          <ClaimCard key={claim.id} locale={locale} claim={claim}>
            <p className="meta">
              {t.orders.number} {claim.orderId.slice(0, 8).toUpperCase()}
            </p>
            {canDecide && claim.status === "ESCALATED" && (
              <div className="inline-forms">
                {(["refund", "close"] as const).map((decision) => (
                  <form
                    key={decision}
                    action={decideClaimAction}
                    className="stack"
                  >
                    <input type="hidden" name="locale" value={locale} />
                    <input type="hidden" name="claimId" value={claim.id} />
                    <input type="hidden" name="decision" value={decision} />
                    <label>
                      {c.decideNote}
                      <input
                        name="note"
                        minLength={10}
                        maxLength={1000}
                        required
                      />
                    </label>
                    <button
                      type="submit"
                      className={decision === "refund" ? "cta" : "secondary"}
                    >
                      {decision === "refund" ? c.refundYes : c.refundNo}
                    </button>
                  </form>
                ))}
              </div>
            )}
          </ClaimCard>
        ))
      )}
    </AccountShell>
  );
}
