import { type Locale, messages } from "@duoshop/i18n";
import Link from "next/link";
import type { ReactNode } from "react";
import { OrdersIcon, ShieldIcon, StoreIcon, TagIcon } from "../icons";

// Panneau latéral encadré des espaces d'administration et vendeur : liste verticale avec
// pictogrammes ; la rubrique ouverte est surlignée (aria-current).
export function SideNav({
  label,
  title,
  items,
  current,
}: {
  label: string;
  title: string;
  items: { href: string; text: string; icon: ReactNode }[];
  current: string;
}) {
  return (
    <nav aria-label={label} className="side-nav">
      <p className="side-nav-title">{title}</p>
      <ul>
        {items.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={
                current.split("?")[0] === item.href.replace(/^\/(fr|en)/, "")
                  ? "page"
                  : undefined
              }
            >
              {item.icon}
              <span>{item.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export function AdminNav({
  locale,
  current = "",
}: {
  locale: Locale;
  current?: string;
}) {
  const t = messages[locale];
  const a = t.admin;
  const href = (p: string) => `/${locale}/admin/${p}`;
  return (
    <SideNav
      label={a.nav}
      title={a.nav}
      current={current}
      items={[
        { href: href("verifications"), text: a.title, icon: <StoreIcon /> },
        {
          href: href("payment-methods"),
          text: a.methods.title,
          icon: <ShieldIcon />,
        },
        {
          href: href("payments"),
          text: a.payments.title,
          icon: <OrdersIcon />,
        },
        {
          href: href("claims"),
          text: t.claims.adminTitle,
          icon: <ShieldIcon />,
        },
        {
          href: href("categories"),
          text: t.categories.adminTitle,
          icon: <TagIcon />,
        },
        {
          href: href("zones"),
          text: t.zones.adminTitle,
          icon: <TagIcon />,
        },
        {
          href: href("commissions"),
          text: t.commissions.nav,
          icon: <TagIcon />,
        },
        { href: href("finance"), text: t.finance.nav, icon: <OrdersIcon /> },
        {
          href: href("invoices"),
          text: t.accounting.invoicesTitle,
          icon: <OrdersIcon />,
        },
        {
          href: href("collection"),
          text: t.collection.adminTitle,
          icon: <ShieldIcon />,
        },
        {
          href: href("privacy"),
          text: t.privacy.admin.requestsTitle,
          icon: <ShieldIcon />,
        },
        {
          href: href("legal"),
          text: t.privacy.admin.legalTitle,
          icon: <ShieldIcon />,
        },
        {
          href: href("access-log"),
          text: t.privacy.admin.accessTitle,
          icon: <ShieldIcon />,
        },
        {
          href: href("parameters"),
          text: t.parameters.nav,
          icon: <ShieldIcon />,
        },
      ]}
    />
  );
}

export function SellerNav({
  locale,
  storeId,
  current,
}: {
  locale: Locale;
  storeId: string;
  current: string;
}) {
  const t = messages[locale];
  const base = `/${locale}/account/stores/${storeId}`;
  return (
    <SideNav
      label={t.header.sellerMenu}
      title={t.header.sellerMenu}
      current={current}
      items={[
        { href: base, text: t.header.myStore, icon: <StoreIcon /> },
        { href: `${base}/catalog`, text: t.catalog.title, icon: <TagIcon /> },
        {
          href: `${base}/orders`,
          text: t.orders.sellerTitle,
          icon: <OrdersIcon />,
        },
        {
          href: `${base}/earnings`,
          text: t.earnings.title,
          icon: <ShieldIcon />,
        },
        {
          href: `${base}/claims`,
          text: t.claims.sellerTitle,
          icon: <ShieldIcon />,
        },
      ]}
    />
  );
}
