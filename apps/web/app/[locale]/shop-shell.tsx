import { brand } from "@duoshop/config";
import { type Locale, messages } from "@duoshop/i18n";
import { getCart, getCategories, getNotifications } from "@duoshop/sdk";
import Link from "next/link";
import type { ReactNode } from "react";
import { apiUrl, shopper } from "../../lib/session";
import { ConsentBanner } from "./consent-banner";
import {
  ArrowUpIcon,
  BellIcon,
  CartIcon,
  GlobeIcon,
  MenuIcon,
  OrdersIcon,
  SearchIcon,
  UserIcon,
} from "./icons";

// En-tête « place de marché » pleine largeur : logo, recherche (sauf accueil, qui a la grande
// recherche), livraison, langue/devise et icônes avec pastilles ; seconde ligne de navigation ;
// barre de raccourcis flottante. Tout fonctionne sans JavaScript.
export async function ShopShell({
  locale,
  path,
  query = "",
  variant = "default",
  children,
}: {
  locale: Locale;
  path: string;
  query?: string;
  variant?: "home" | "default";
  children: ReactNode;
}) {
  const t = messages[locale];
  const h = t.header;
  // Compteurs (compte ou visiteur) et rubriques ; une erreur ne bloque jamais la page.
  const credentials = await shopper();
  const [cart, inbox, categories] = await Promise.all([
    credentials.session || credentials.cart
      ? getCart(apiUrl, credentials).catch(() => null)
      : null,
    credentials.session
      ? getNotifications(apiUrl, credentials.session).catch(() => null)
      : null,
    getCategories(apiUrl, locale).catch(() => []),
  ]);
  const count = cart?.ok ? cart.data.itemCount : 0;
  const unread = inbox?.ok ? inbox.data.unread : 0;
  const badge = (n: number) =>
    n > 0 ? <span className="icon-badge">{n > 99 ? "99+" : n}</span> : null;
  return (
    <div className="shop-page" id="top">
      <a className="skip" href="#main">
        {locale === "fr" ? "Aller au contenu" : "Skip to content"}
      </a>
      <header className="shop-header">
        <div className="shop-header-inner">
          <Link className="wordmark brand-mark" href={`/${locale}`}>
            {brand.name}
          </Link>
          {variant !== "home" && (
            <search className="header-search">
              <form
                action={`/${locale}/products`}
                method="get"
                className="pill-search"
              >
                <label htmlFor="q" className="visually-hidden">
                  {t.shop.search}
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={query}
                  maxLength={100}
                  placeholder={t.shop.search}
                />
                <button type="submit" className="gradient-button">
                  <SearchIcon /> {t.shop.searchButton}
                </button>
              </form>
            </search>
          )}
          <nav aria-label={t.account} className="header-tools">
            <span className="deliver-to">
              <span className="meta">{h.deliverTo}</span>
              <span>
                <span className="flag-cm" aria-hidden="true" /> Douala · CM
              </span>
            </span>
            {/* Langue et devise : fenêtre déroulante sans JavaScript (<details>), formulaire GET. */}
            <details className="lang-menu">
              <summary className="lang-switch">
                <GlobeIcon /> {h.langCurrency}
              </summary>
              <div className="lang-panel">
                <p className="lang-title">{h.langTitle}</p>
                <p>{h.langText}</p>
                <form action="/switch-locale" method="get" className="stack">
                  <input type="hidden" name="to" value={path} />
                  <label>
                    {h.languageLabel}
                    <select name="lang" defaultValue={locale}>
                      <option value="fr">Français</option>
                      <option value="en">English</option>
                    </select>
                  </label>
                  <label>
                    {h.currencyLabel}
                    <select name="currency" defaultValue="XAF">
                      <option value="XAF">{h.currencyXaf}</option>
                    </select>
                  </label>
                  <p className="hint">{h.currencyNote}</p>
                  <button type="submit" className="save-button">
                    {h.save}
                  </button>
                </form>
              </div>
            </details>
            <Link
              href={`/${locale}/cart`}
              className="icon-link"
              aria-label={`${t.shop.cart} : ${count} ${t.cartCount}`}
            >
              <CartIcon />
              {badge(count)}
            </Link>
            {inbox?.ok && (
              <Link
                href={`/${locale}/notifications`}
                className="icon-link"
                aria-label={`${t.notifications.title} : ${unread} ${t.notifications.unread}`}
              >
                <BellIcon />
                {badge(unread)}
              </Link>
            )}
            <Link
              href={`/${locale}/orders`}
              className="icon-link"
              aria-label={t.orders.title}
            >
              <OrdersIcon />
            </Link>
            <Link
              href={`/${locale}/account`}
              className="icon-link"
              aria-label={t.account}
            >
              <UserIcon />
            </Link>
          </nav>
        </div>
        <nav aria-label={h.allCategories} className="header-links">
          <div className="header-links-inner">
            <Link href={`/${locale}/products`} className="all-categories">
              <MenuIcon /> {h.allCategories}
            </Link>
            {categories.slice(0, 3).map((c) => (
              <Link
                key={c.id}
                href={`/${locale}/products?${new URLSearchParams({ category: c.slug })}`}
              >
                {c.name}
              </Link>
            ))}
            <span className="spacer" />
            <Link href={`/${locale}/orders`}>{t.orders.title}</Link>
            <Link href={`/${locale}/account/stores/new`}>{h.sell}</Link>
          </div>
        </nav>
      </header>
      <main id="main" className="shop">
        <ConsentBanner locale={locale} />
        {children}
      </main>
      <footer className="shop-footer">
        <span>© {brand.name}</span>
        <Link href={`/${locale}/credits`}>{h.credits}</Link>
        <Link href={`/${locale}/legal/cgu`}>{t.privacy.kinds.CGU}</Link>
        <Link href={`/${locale}/legal/cgv`}>{t.privacy.kinds.CGV}</Link>
        <Link href={`/${locale}/legal/privacy`}>{t.privacy.kinds.PRIVACY}</Link>
      </footer>
      <nav aria-label={h.tools} className="floating-tools">
        <Link
          href={`/${locale}/cart`}
          aria-label={`${t.shop.cart} : ${count} ${t.cartCount}`}
        >
          <CartIcon />
          {badge(count)}
        </Link>
        {inbox?.ok && (
          <Link
            href={`/${locale}/notifications`}
            aria-label={`${t.notifications.title} : ${unread} ${t.notifications.unread}`}
          >
            <BellIcon />
            {badge(unread)}
          </Link>
        )}
        <a href="#top" aria-label={h.backToTop}>
          <ArrowUpIcon />
        </a>
      </nav>
    </div>
  );
}
