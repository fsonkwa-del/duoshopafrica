import { formatDateTime, isLocale, messages } from "@duoshop/i18n";
import { getNotifications } from "@duoshop/sdk";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../lib/session";
import { ShopShell } from "../shop-shell";
import { markReadAction } from "./actions";

export default async function Notifications({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const n = t.notifications;
  const token = await sessionToken();
  const result = token ? await getNotifications(apiUrl, token) : null;
  if (!result?.ok)
    return (
      <ShopShell locale={locale} path="/notifications">
        <h1>{n.title}</h1>
        <a
          className="cta"
          href={`/v1/auth/login?${new URLSearchParams({ returnTo: `/${locale}/notifications`, locale })}`}
        >
          {t.signIn}
        </a>
      </ShopShell>
    );
  const { notifications, unread } = result.data;
  return (
    <ShopShell locale={locale} path="/notifications">
      <h1>{n.title}</h1>
      {unread > 0 && (
        <form action={markReadAction}>
          <input type="hidden" name="locale" value={locale} />
          <p>
            {unread} {n.unread} ·{" "}
            <button type="submit" className="link-button">
              {n.markRead}
            </button>
          </p>
        </form>
      )}
      {notifications.length === 0 ? (
        <p>{n.empty}</p>
      ) : (
        <ul className="cart-lines">
          {notifications.map((item) => {
            const label =
              item.kind in n.kinds
                ? n.kinds[item.kind as keyof typeof n.kinds]
                : item.kind;
            const href = item.orderId
              ? `/${locale}/orders/${item.orderId}`
              : item.data.storeId
                ? `/${locale}/account/stores/${item.data.storeId}/orders`
                : null;
            return (
              <li key={item.id}>
                <span>
                  {!item.read && <strong>● </strong>}
                  {label} {item.data.storeName}
                  {item.data.reference ? ` (${item.data.reference})` : ""}
                  <br />
                  <time dateTime={item.createdAt} className="meta">
                    {formatDateTime(item.createdAt, locale)}
                  </time>
                </span>
                {href && <Link href={href}>{n.open}</Link>}
              </li>
            );
          })}
        </ul>
      )}
    </ShopShell>
  );
}
