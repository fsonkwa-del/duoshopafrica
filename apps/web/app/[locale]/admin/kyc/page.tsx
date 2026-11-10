import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getKycQueue } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { reviewKycAction } from "./actions";

// Dossiers KYC à instruire (lot 5). Une pièce s'ouvre par un formulaire POST direct vers l'API
// (motif journalisé) : le fichier déchiffré ne transite jamais par une URL ni par le site.
export default async function KycQueue({
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
  const k = t.kyc;
  const path = "/admin/kyc";
  const token = await sessionToken();
  const result = token ? await getKycQueue(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const errorText = (code: string | undefined) =>
    code && code in k.errors
      ? k.errors[code as keyof typeof k.errors]
      : k.errors.unknown;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{k.adminTitle}</h1>
        <Notice>
          {result.status === 404 ? t.admin.notStaff : errorText(result.error)}
        </Notice>
      </AccountShell>
    );
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} current={path} />
      <h1>{k.adminTitle}</h1>
      <p>{k.adminIntro}</p>
      {query.saved && <Notice>{k.decided}</Notice>}
      {query.error && <Notice>{errorText(query.error)}</Notice>}
      {result.data.queue.length === 0 ? (
        <p>{k.none}</p>
      ) : (
        <ul className="stack">
          {result.data.queue.map((item) => (
            <li key={item.storeId} className="panel">
              <h2>{item.storeName}</h2>
              <p className="meta">
                {k.tiers[(item.requestedTier ?? 1) as 1 | 2 | 3]} ·{" "}
                {item.submittedAt
                  ? formatDateTime(item.submittedAt, locale)
                  : ""}
                <br />
                {item.location} · {item.mobileMoneyNumber}
                {item.niu ? ` · NIU ${item.niu}` : ""}
              </p>
              <ul>
                {item.documents.map((d) => (
                  <li key={d.id}>
                    {k.types[d.documentType]}
                    <form
                      method="post"
                      action={`/v1/admin/kyc/documents/${d.id}/view`}
                      target="_blank"
                      className="inline-forms"
                      rel="noopener"
                    >
                      <input
                        name="reason"
                        aria-label={k.viewReason}
                        placeholder={k.viewReason}
                        minLength={10}
                        maxLength={500}
                        required
                      />
                      <button type="submit" className="link-button">
                        {k.view}
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
              <form action={reviewKycAction} className="stack">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="storeId" value={item.storeId} />
                <label>
                  {k.reason}
                  <input name="reason" maxLength={1000} />
                </label>
                <div className="inline-forms">
                  <button
                    type="submit"
                    name="decision"
                    value="approve"
                    className="cta"
                  >
                    {k.approve}
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="reject"
                    className="link-button"
                  >
                    {k.reject}
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
