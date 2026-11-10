import { isLocale, messages } from "@duoshop/i18n";
import { getLegalTexts, getMyPrivacy } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { AccountShell, SignIn } from "../account-shell";
import { acceptTermsAction } from "./actions";

export default async function Consent({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ accepted?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const p = t.privacy;
  const path = "/account/consent";
  const token = await sessionToken();
  const result = token ? await getMyPrivacy(apiUrl, token) : null;
  if (!result?.ok) return <SignIn locale={locale} path={path} />;
  const texts = await getLegalTexts(apiUrl, locale);
  const pending = result.data.pending.flatMap((d) => {
    const text = texts.find(
      (x) => x.kind === d.kind && x.version === d.version,
    );
    return text ? [text] : [];
  });
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <h1>{p.consentTitle}</h1>
      {query.accepted && <Notice>{p.accepted}</Notice>}
      {query.error && <Notice>{p.admin.errors.unknown}</Notice>}
      {pending.length === 0 ? (
        <p>
          {p.noneTitle} <Link href={`/${locale}/account`}>{t.account}</Link>
        </p>
      ) : (
        <form action={acceptTermsAction} className="stack">
          <p>{p.consentIntro}</p>
          <input type="hidden" name="locale" value={locale} />
          {pending.map((doc) => (
            <section key={doc.kind} className="panel">
              <h2>
                {doc.title} ({p.version} {doc.version})
              </h2>
              <div className="legal-text">{doc.body}</div>
              <input
                type="hidden"
                name="doc"
                value={`${doc.kind}:${doc.version}`}
              />
            </section>
          ))}
          <button type="submit" className="cta">
            {p.accept}
          </button>
        </form>
      )}
    </AccountShell>
  );
}
