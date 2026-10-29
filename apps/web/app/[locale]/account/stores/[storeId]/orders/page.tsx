import { nextFulfilmentSteps } from "@duoshop/domain";
import { formatDateTime, formatMoney, isLocale, messages } from "@duoshop/i18n";
import { listSellerOrders } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../../../lib/session";
import { AccountShell, SignIn } from "../../../account-shell";
import { advanceAction } from "./actions";

export default async function SellerOrders({
  params,
  searchParams,
}: {
  searchParams: Promise<{ done?: string; error?: string }>;
  params: Promise<{ locale: string; storeId: string }>;
}) {
  const { locale, storeId } = await params;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const o = t.orders;
  const fu = t.tracking;
  const query = await searchParams;
  const path = `/account/stores/${storeId}/orders`;
  const token = await sessionToken();
  const result = token ? await listSellerOrders(apiUrl, token, storeId) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const back = (
    <p>
      <Link href={`/${locale}/account/stores/${storeId}`}>{t.backToStore}</Link>
    </p>
  );
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        {back}
        <Notice>
          {result.status === 403 ? t.storeUnavailable : t.storeNotFound}
        </Notice>
      </AccountShell>
    );
  return (
    <AccountShell locale={locale} path={path} signedIn>
      {back}
      <h1>{o.sellerTitle}</h1>
      <Notice>{o.sellerNotice}</Notice>
      {query.done && <Notice>{fu.done}</Notice>}
      {query.error && (
        <Notice>
          {query.error in fu.errors
            ? fu.errors[query.error as keyof typeof fu.errors]
            : fu.errors.unknown}
        </Notice>
      )}
      {result.data.orders.length === 0 ? (
        <p>{o.empty}</p>
      ) : (
        <ul className="queue">
          {result.data.orders.map((order) => (
            <li key={order.id} id={`o-${order.id}`} className="panel">
              <h2>
                {o.number} {order.orderId.slice(0, 8).toUpperCase()} ·{" "}
                <span className="badge">
                  {order.status === "PAID"
                    ? fu.statuses[order.fulfilmentStatus]
                    : o.statuses[order.status]}
                </span>
              </h2>
              <p>
                {formatDateTime(order.createdAt, locale)} ·{" "}
                {order.deliveryMethod === "PICKUP"
                  ? t.checkout.pickup
                  : t.checkout.home}
              </p>
              <ul className="cart-lines">
                {order.items.map((item) => (
                  <li key={`${item.title}-${item.label}`}>
                    <span>
                      {item.title} — {item.label} × {item.quantity}
                    </span>
                    <strong>
                      {formatMoney(
                        BigInt(item.lineTotal.amountMinor),
                        item.lineTotal.currency,
                        locale,
                      )}
                    </strong>
                  </li>
                ))}
              </ul>
              {order.deliveryContact && (
                <dl className="facts">
                  <dt>{o.deliverTo}</dt>
                  <dd>
                    {order.deliveryContact.recipientName} ·{" "}
                    <a href={`tel:${order.deliveryContact.phone}`}>
                      {order.deliveryContact.phone}
                    </a>
                    <br />
                    {order.deliveryContact.district},{" "}
                    {order.deliveryContact.city} —{" "}
                    {order.deliveryContact.landmark}
                    {order.deliveryContact.details
                      ? ` (${order.deliveryContact.details})`
                      : ""}
                  </dd>
                </dl>
              )}
              {order.status === "PAID" && order.handoverLocked && (
                <Notice>{fu.locked}</Notice>
              )}
              {order.status === "PAID" && !order.handoverLocked && (
                <div className="inline-forms">
                  {nextFulfilmentSteps(
                    order.deliveryMethod,
                    order.fulfilmentStatus,
                  ).map((to) => (
                    <form key={to} action={advanceAction} className="stack">
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="storeId" value={storeId} />
                      <input
                        type="hidden"
                        name="sellerOrderId"
                        value={order.id}
                      />
                      <input type="hidden" name="to" value={to} />
                      <input
                        type="hidden"
                        name="expectedVersion"
                        value={order.fulfilmentVersion}
                      />
                      {to === "DELIVERED" && (
                        <label>
                          {fu.codeLabel}
                          <input
                            name="code"
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            maxLength={6}
                            autoComplete="off"
                            required
                          />
                        </label>
                      )}
                      {to === "DELIVERY_FAILED" && (
                        <label>
                          {fu.noteLabel}
                          <input
                            name="note"
                            minLength={3}
                            maxLength={300}
                            required
                          />
                        </label>
                      )}
                      <button
                        type="submit"
                        className={
                          to === "DELIVERY_FAILED" ? "secondary" : "cta"
                        }
                      >
                        {fu.actions[to as keyof typeof fu.actions]}
                      </button>
                    </form>
                  ))}
                </div>
              )}
              {order.events.length > 0 && (
                <ol className="timeline" aria-label={fu.title}>
                  {order.events.map((e) => (
                    <li key={`${e.status}-${e.createdAt}`}>
                      <time dateTime={e.createdAt}>
                        {formatDateTime(e.createdAt, locale)}
                      </time>{" "}
                      — {fu.statuses[e.status]}
                      {e.note ? ` (${e.note})` : ""}
                    </li>
                  ))}
                </ol>
              )}
            </li>
          ))}
        </ul>
      )}
    </AccountShell>
  );
}
