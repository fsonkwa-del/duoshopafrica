import { isLocale, messages } from "@duoshop/i18n";
import { listStoreClaims } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../../../lib/session";
import { SellerNav } from "../../../../admin/admin-nav";
import { ClaimCard } from "../../../../claim-card";
import { AccountShell, SignIn } from "../../../account-shell";
import { respondClaimAction } from "./actions";

export default async function StoreClaims({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; storeId: string }>;
  searchParams: Promise<{ done?: string; error?: string }>;
}) {
  const { locale, storeId } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const c = t.claims;
  const path = `/account/stores/${storeId}/claims`;
  const token = await sessionToken();
  const result = token ? await listStoreClaims(apiUrl, token, storeId) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const back = (
    <p>
      <Link href={`/${locale}/account/stores/${storeId}`}>{t.backToStore}</Link>
    </p>
  );
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        {back}
        <Notice>
          {result.status === 403 ? c.errors.forbidden : t.storeNotFound}
        </Notice>
      </AccountShell>
    );
  const { claims, canRespond } = result.data;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <SellerNav locale={locale} storeId={storeId} current={path} />
      {back}
      <h1>{c.sellerTitle}</h1>
      {!canRespond && <Notice>{c.sellerReadOnly}</Notice>}
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
            {canRespond && claim.status === "OPEN" && (
              <div className="inline-forms">
                <form action={respondClaimAction}>
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="storeId" value={storeId} />
                  <input type="hidden" name="claimId" value={claim.id} />
                  <input
                    type="hidden"
                    name="expectedVersion"
                    value={claim.version}
                  />
                  <input type="hidden" name="decision" value="accept" />
                  <button type="submit" className="cta">
                    {c.accept}
                  </button>
                </form>
                <form action={respondClaimAction} className="stack">
                  <input type="hidden" name="locale" value={locale} />
                  <input type="hidden" name="storeId" value={storeId} />
                  <input type="hidden" name="claimId" value={claim.id} />
                  <input
                    type="hidden"
                    name="expectedVersion"
                    value={claim.version}
                  />
                  <input type="hidden" name="decision" value="reject" />
                  <label>
                    {c.rejectNote}
                    <input
                      name="note"
                      minLength={10}
                      maxLength={1000}
                      required
                    />
                  </label>
                  <button type="submit" className="secondary">
                    {c.reject}
                  </button>
                </form>
              </div>
            )}
          </ClaimCard>
        ))
      )}
    </AccountShell>
  );
}
