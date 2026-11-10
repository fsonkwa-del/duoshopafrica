import { brand } from "@duoshop/config";
import { type Locale, messages } from "@duoshop/i18n";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConsentBanner } from "../consent-banner";
import { GlobeIcon } from "../icons";
import { signOut } from "./actions";

// Espaces compte, vendeur et administration : même en-tête blanc pleine largeur que la
// boutique, contenu fluide. Un menu latéral (SideNav) placé en premier enfant forme une
// colonne encadrée à gauche (voir .account:has(> .side-nav)).
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
    <div className="shop-page">
      <a className="skip" href="#main">
        {locale === "fr" ? "Aller au contenu" : "Skip to content"}
      </a>
      <header className="shop-header">
        <div className="shop-header-inner">
          <Link className="wordmark brand-mark" href={`/${locale}`}>
            {brand.name}
          </Link>
          <nav aria-label={t.account} className="header-tools">
            <Link
              href={`/${other}${path}`}
              hrefLang={other}
              className="lang-switch"
            >
              <GlobeIcon /> {t.language}
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
        </div>
      </header>
      <main id="main" className="shop account">
        {signedIn && !path.startsWith("/account/consent") && (
          <ConsentBanner locale={locale} />
        )}
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
