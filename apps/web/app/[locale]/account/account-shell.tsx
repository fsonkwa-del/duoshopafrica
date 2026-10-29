import { brand } from "@duoshop/config";
import { type Locale, messages } from "@duoshop/i18n";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { signOut } from "./actions";

export function AccountShell({
  locale,
  path,
  signedIn,
  children,
}: {
  locale: Locale;
  path: string;
  signedIn: boolean;
  children: ReactNode;
}) {
  const t = messages[locale];
  const other = locale === "fr" ? "en" : "fr";
  return (
    <div className="shell">
      <a className="skip" href="#main">
        {locale === "fr" ? "Aller au contenu" : "Skip to content"}
      </a>
      <header>
        <Link className="wordmark" href={`/${locale}`}>
          {brand.name}
        </Link>
        <nav aria-label={t.account} className="account-nav">
          <Link href={`/${other}${path}`} hrefLang={other}>
            {t.language}
          </Link>
          {signedIn && (
            <form action={signOut}>
              <input type="hidden" name="locale" value={locale} />
              <button type="submit" className="link-button">
                {t.signOut}
              </button>
            </form>
          )}
        </nav>
      </header>
      <main id="main" className="account">
        {children}
      </main>
    </div>
  );
}

export function SignIn({
  locale,
  path,
  failed = false,
}: {
  locale: Locale;
  path: string;
  failed?: boolean;
}) {
  const t = messages[locale];
  const login = `/v1/auth/login?${new URLSearchParams({ returnTo: `/${locale}${path}`, locale })}`;
  return (
    <AccountShell locale={locale} path={path} signedIn={false}>
      <h1>{t.signInRequired}</h1>
      {failed && <Notice>{t.loginFailed}</Notice>}
      <p>{t.signInHelp}</p>
      {/* Lien plein : la navigation doit quitter l'application vers le fournisseur d'identité. */}
      <a className="cta" href={login}>
        {t.signIn}
      </a>
    </AccountShell>
  );
}
