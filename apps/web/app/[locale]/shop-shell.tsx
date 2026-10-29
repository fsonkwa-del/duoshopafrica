import { brand } from "@duoshop/config";
import { type Locale, messages } from "@duoshop/i18n";
import { getCart, getNotifications } from "@duoshop/sdk";
import Link from "next/link";
import type { ReactNode } from "react";
import { apiUrl, shopper } from "../../lib/session";

// En-tête de la vitrine : recherche accessible sans JavaScript (formulaire GET), panier, compte.
export async function ShopShell({
  locale,
  path,
  query = "",
  children,
}: {
  locale: Locale;
  path: string;
  query?: string;
  children: ReactNode;
}) {
  const t = messages[locale];
  const other = locale === "fr" ? "en" : "fr";
  // Compteur du panier (compte ou visiteur) ; une erreur ne bloque jamais la page.
  const credentials = await shopper();
  const cart =
    credentials.session || credentials.cart
      ? await getCart(apiUrl, credentials).catch(() => null)
      : null;
  const count = cart?.ok ? cart.data.itemCount : 0;
  const inbox = credentials.session
    ? await getNotifications(apiUrl, credentials.session).catch(() => null)
    : null;
  const unread = inbox?.ok ? inbox.data.unread : 0;
  return (
    <div className="shell">
      <a className="skip" href="#main">
        {locale === "fr" ? "Aller au contenu" : "Skip to content"}
      </a>
      <header className="shop-header">
        <Link className="wordmark" href={`/${locale}`}>
          {brand.name}
        </Link>
        <search>
          <form action={`/${locale}/products`} method="get" className="search">
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
            <button type="submit" className="cta">
              {t.shop.searchButton}
            </button>
          </form>
        </search>
        <nav aria-label={t.account} className="account-nav">
          <Link
            href={`/${locale}/cart`}
            aria-label={`${t.shop.cart} : ${count} ${t.cartCount}`}
          >
            {t.shop.cart}
            {count > 0 && <span className="badge cart-count">{count}</span>}
          </Link>
          <Link href={`/${locale}/orders`}>{t.orders.title}</Link>
          {inbox?.ok && (
            <Link
              href={`/${locale}/notifications`}
              aria-label={`${t.notifications.title} : ${unread} ${t.notifications.unread}`}
            >
              {t.notifications.title}
              {unread > 0 && <span className="badge cart-count">{unread}</span>}
            </Link>
          )}
          <Link href={`/${locale}/account`}>{t.account}</Link>
          <Link href={`/${other}${path}`} hrefLang={other}>
            {t.language}
          </Link>
        </nav>
      </header>
      <main id="main" className="shop">
        {children}
      </main>
    </div>
  );
}
