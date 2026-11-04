import { isLocale, messages } from "@duoshop/i18n";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { sessionToken } from "../../../../../lib/session";
import { AccountShell, SignIn } from "../../account-shell";
import { openStoreAction } from "./actions";

export default async function OpenStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { error } = await searchParams;
  const t = messages[locale];
  const o = t.openStore;
  const path = "/account/stores/new";
  if (!(await sessionToken())) return <SignIn locale={locale} path={path} />;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <p>
        <Link href={`/${locale}/account`}>{t.backToStores}</Link>
      </p>
      <h1>{o.title}</h1>
      <p>{o.intro}</p>
      {error && (
        <Notice>
          {error in o.errors
            ? o.errors[error as keyof typeof o.errors]
            : o.errors.unknown}
        </Notice>
      )}
      <form action={openStoreAction} className="stack panel">
        <input type="hidden" name="locale" value={locale} />
        <label>
          {o.name}
          <input name="name" required minLength={2} maxLength={80} />
        </label>
        <label>
          {o.slug}
          <input
            name="slug"
            required
            minLength={3}
            maxLength={40}
            autoCapitalize="none"
            spellCheck={false}
            aria-describedby="slug-hint"
          />
        </label>
        <p id="slug-hint" className="meta">
          {o.slugHint}
        </p>
        <button type="submit" className="cta">
          {o.submit}
        </button>
      </form>
    </AccountShell>
  );
}
