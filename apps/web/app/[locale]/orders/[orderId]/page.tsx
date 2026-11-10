import { randomUUID } from "node:crypto";
import {
  formatDateTime,
  formatMoney,
  isLocale,
  type Locale,
  messages,
} from "@duoshop/i18n";
import { getOrder, listPaymentMethods } from "@duoshop/sdk";
import type { MoneyDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { cancelOrderAction } from "../../checkout/actions";
import { ClaimCard } from "../../claim-card";
import { SellerLegal } from "../../seller-legal";
import { ShopShell } from "../../shop-shell";
import { claimStepAction, payAction, simulateAction } from "./actions";

const money = (m: MoneyDTO, locale: Locale) =>
  formatMoney(BigInt(m.amountMinor), m.currency, locale);

function errorText<T extends { unknown: string }>(
  errors: T,
  code: string | undefined,
): string {
  return code && code in errors
    ? String(errors[code as keyof T])
    : errors.unknown;
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<{
    placed?: string;
    cancelled?: string;
    error?: string;
    payError?: string;
    claimSent?: string;
    claimError?: string;
  }>;
}) {
  const { locale, orderId } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const o = t.orders;
  const c = t.checkout;
  const p = t.payment;
  const fu = t.tracking;
  const cl = t.claims;
  const token = await sessionToken();
  const result = token ? await getOrder(apiUrl, token, orderId) : null;
  if (!token || !result?.ok) notFound();
  const order = result.data;
  const payable = order.status === "AWAITING_PAYMENT";
  const pending = order.payments.find((x) => x.status === "PENDING");
  const methods =
    payable && !pending
      ? await listPaymentMethods(apiUrl, token, order.id)
      : null;
  const options = methods?.ok ? methods.data.methods : [];
  const label = (m: { labelFr: string; labelEn: string }) =>
    locale === "fr" ? m.labelFr : m.labelEn;
  return (
    <ShopShell locale={locale} path={`/orders/${order.id}`}>
      <p>
        <Link href={`/${locale}/orders`}>{o.title}</Link>
      </p>
      <h1>
        {o.number} {order.id.slice(0, 8).toUpperCase()}
      </h1>
      {query.cancelled && <Notice>{o.cancelled}</Notice>}
      {query.error && <Notice>{errorText(o.errors, query.error)}</Notice>}
      {query.claimSent && <Notice>{cl.sent}</Notice>}
      {query.claimError && (
        <Notice>{errorText(cl.errors, query.claimError)}</Notice>
      )}
      <p>
        <strong>{o.statuses[order.status]}</strong> · {o.placed}{" "}
        {formatDateTime(order.createdAt, locale)}
      </p>
      {order.status === "PAID" && order.paidAt && (
        <Notice>
          {p.paid} {o.paidOn} {formatDateTime(order.paidAt, locale)}.
        </Notice>
      )}
      {payable && (
        <section className="panel" aria-labelledby="payment">
          <h2 id="payment">{p.title}</h2>
          {query.payError && (
            <Notice>{errorText(p.errors, query.payError)}</Notice>
          )}
          <p>
            {o.expires} {formatDateTime(order.expiresAt, locale)}.
          </p>
          {pending ? (
            <>
              {pending.mode !== "LIVE" && (
                <Notice>
                  {pending.mode === "MOCK" ? p.testMode : p.sandbox}
                </Notice>
              )}
              <p>{p.pending}</p>
              {pending.nextAction?.type === "approve_on_phone" && (
                <>
                  {/* Sans JavaScript : la page se recharge seule pendant l'attente (lot 3). */}
                  <meta httpEquiv="refresh" content="10" />
                  <Notice>{p.approveOnPhone}</Notice>
                </>
              )}
              {pending.nextAction?.type === "redirect" &&
                pending.nextAction.url.startsWith("https://") && (
                  <p>
                    <a
                      className="cta"
                      href={pending.nextAction.url}
                      rel="noopener noreferrer"
                    >
                      {p.redirect}
                    </a>
                  </p>
                )}
              {pending.nextAction?.type === "test_simulator" && (
                <div className="actions">
                  {(["SUCCEEDED", "FAILED"] as const).map((outcome) => (
                    <form key={outcome} action={simulateAction}>
                      <input type="hidden" name="locale" value={locale} />
                      <input type="hidden" name="orderId" value={order.id} />
                      <input
                        type="hidden"
                        name="paymentId"
                        value={pending.id}
                      />
                      <input type="hidden" name="outcome" value={outcome} />
                      <button
                        type="submit"
                        className={
                          outcome === "SUCCEEDED" ? "cta" : "secondary"
                        }
                      >
                        {outcome === "SUCCEEDED" ? p.simulateOk : p.simulateKo}
                      </button>
                    </form>
                  ))}
                </div>
              )}
              <p>
                <Link href={`/${locale}/orders/${order.id}`}>{p.refresh}</Link>
              </p>
            </>
          ) : options.length === 0 ? (
            <p>{p.none}</p>
          ) : (
            <form action={payAction} className="stack">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="orderId" value={order.id} />
              {/* Clé fixée au rendu : un double envoi n'ouvre qu'une tentative. */}
              <input
                type="hidden"
                name="idempotencyKey"
                value={randomUUID().replaceAll("-", "")}
              />
              <fieldset>
                <legend>{p.choose}</legend>
                {options.map((m, i) => (
                  <label key={m.code} className="variant-choice">
                    <input
                      type="radio"
                      name="methodCode"
                      value={m.code}
                      defaultChecked={i === 0}
                      required
                    />
                    <span>
                      {label(m)}
                      {m.mode !== "LIVE" ? " — TEST" : ""}
                    </span>
                    {(locale === "fr"
                      ? m.instructionsFr
                      : m.instructionsEn) && (
                      <span className="hint">
                        {locale === "fr" ? m.instructionsFr : m.instructionsEn}
                      </span>
                    )}
                  </label>
                ))}
              </fieldset>
              {options.some((m) => m.mode !== "LIVE") && (
                <Notice>{p.testMode}</Notice>
              )}
              {options.some((m) => m.requiresPhone) && (
                <label>
                  {p.phone}
                  <input
                    name="payerPhone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={32}
                  />
                </label>
              )}
              <button type="submit" className="cta">
                {p.pay} {money(order.total, locale)}
              </button>
            </form>
          )}
          <p className="hint">{p.serverTruth}</p>
        </section>
      )}
      {order.sellers.map((seller) => (
        <section key={seller.id} className="panel">
          <h2>
            {o.seller} : {seller.storeName}
          </h2>
          <p>
            {seller.deliveryMethod === "PICKUP" ? c.pickup : c.home}
            {seller.pickupInstructions ? ` — ${seller.pickupInstructions}` : ""}
          </p>
          {seller.status === "PAID" && (
            <>
              <p>
                <span className="badge">
                  {seller.fulfilmentStatus === "READY" &&
                  seller.deliveryMethod === "PICKUP"
                    ? fu.readyPickup
                    : fu.statuses[seller.fulfilmentStatus]}
                </span>
              </p>
              {seller.handoverCode && (
                <div className="notice handover">
                  <p>
                    {fu.codeTitle} :{" "}
                    <strong className="handover-code">
                      {seller.handoverCode}
                    </strong>
                  </p>
                  <p>{fu.codeHelp}</p>
                </div>
              )}
              <ol className="timeline" aria-label={fu.title}>
                {seller.events.map((e) => (
                  <li key={`${e.status}-${e.createdAt}`}>
                    <time dateTime={e.createdAt}>
                      {formatDateTime(e.createdAt, locale)}
                    </time>{" "}
                    — {fu.statuses[e.status]}
                    {e.note ? ` (${e.note})` : ""}
                  </li>
                ))}
              </ol>
              {seller.claimable && (
                <p>
                  {seller.claimDeadline && (
                    <span className="meta">
                      {cl.deadline}{" "}
                      {formatDateTime(seller.claimDeadline, locale)}{" "}
                    </span>
                  )}
                  <Link
                    className="secondary"
                    href={`/${locale}/orders/${order.id}/claim?seller=${seller.id}`}
                  >
                    {cl.report}
                  </Link>
                </p>
              )}
              {seller.sellerLegal && (
                <details>
                  <summary>{t.legal.mentionsTitle}</summary>
                  <SellerLegal locale={locale} legal={seller.sellerLegal} />
                </details>
              )}
              {seller.claims.map((claim) => (
                <ClaimCard key={claim.id} locale={locale} claim={claim}>
                  <div className="inline-forms">
                    {(claim.status === "REJECTED"
                      ? (["escalate", "withdraw"] as const)
                      : claim.status === "OPEN" || claim.status === "ESCALATED"
                        ? (["withdraw"] as const)
                        : []
                    ).map((action) => (
                      <form key={action} action={claimStepAction}>
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="orderId" value={order.id} />
                        <input type="hidden" name="claimId" value={claim.id} />
                        <input type="hidden" name="action" value={action} />
                        <button
                          type="submit"
                          className={
                            action === "escalate" ? "cta" : "secondary"
                          }
                        >
                          {action === "escalate" ? cl.escalate : cl.withdraw}
                        </button>
                      </form>
                    ))}
                  </div>
                </ClaimCard>
              ))}
            </>
          )}
          <ul className="cart-lines">
            {seller.items.map((item) => (
              <li key={`${item.title}-${item.label}`}>
                <span>
                  {item.title} — {item.label} × {item.quantity}
                </span>
                <strong>{money(item.lineTotal, locale)}</strong>
              </li>
            ))}
          </ul>
          <p className="subtotal">
            {c.deliveryTotal} : {money(seller.deliveryFee, locale)}
          </p>
        </section>
      ))}
      <dl className="facts">
        <dt>{c.items}</dt>
        <dd>{money(order.itemsTotal, locale)}</dd>
        <dt>{c.deliveryTotal}</dt>
        <dd>{money(order.deliveryTotal, locale)}</dd>
        <dt>{c.total}</dt>
        <dd>
          <strong>{money(order.total, locale)}</strong>
        </dd>
      </dl>
      {order.payments.length > 0 && (
        <section aria-labelledby="attempts">
          <h2 id="attempts">{p.history}</h2>
          <ul className="cart-lines">
            {order.payments.map((x) => (
              <li key={x.id}>
                <span>
                  {formatDateTime(x.createdAt, locale)} · {x.methodCode}
                  {x.payerPhoneHint ? ` (${x.payerPhoneHint})` : ""}
                  {x.mode !== "LIVE" ? " · TEST" : ""}
                  {x.failureCode
                    ? ` — ${errorText(p.errors, x.failureCode)}`
                    : ""}
                </span>
                <strong>{p.statuses[x.status]}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      {payable && !pending && (
        <form action={cancelOrderAction}>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="orderId" value={order.id} />
          <button type="submit" className="secondary">
            {o.cancel}
          </button>
        </form>
      )}
    </ShopShell>
  );
}
