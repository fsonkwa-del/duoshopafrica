import { formatDateTime, formatMoney, isLocale, messages } from "@duoshop/i18n";
import { listOrders } from "@duoshop/sdk";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../lib/session";
import { ShopShell } from "../shop-shell";

export default async function Orders({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const o = t.orders;
  const token = await sessionToken();
  const result = token ? await listOrders(apiUrl, token) : null;
  if (!result?.ok)
    return (
      <ShopShell locale={locale} path="/orders">
        <h1>{o.title}</h1>
        <a
          className="cta"
          href={`/v1/auth/login?${new URLSearchParams({ returnTo: `/${locale}/orders`, locale })}`}
        >
          {t.signIn}
        </a>
      </ShopShell>
    );
  return (
    <ShopShell locale={locale} path="/orders">
      <h1>{o.title}</h1>
      {result.data.orders.length === 0 ? (
        <p>{o.empty}</p>
      ) : (
        <ul className="cart-lines">
          {result.data.orders.map((order) => (
            <li key={order.id}>
              <div>
                <Link href={`/${locale}/orders/${order.id}`}>
                  {o.number} {order.id.slice(0, 8).toUpperCase()}
                </Link>
                <br />
                {o.placed} {formatDateTime(order.createdAt, locale)} ·{" "}
                {o.statuses[order.status]}
              </div>
              <strong>
                {formatMoney(
                  BigInt(order.total.amountMinor),
                  order.total.currency,
                  locale,
                )}
              </strong>
            </li>
          ))}
        </ul>
      )}
    </ShopShell>
  );
}
