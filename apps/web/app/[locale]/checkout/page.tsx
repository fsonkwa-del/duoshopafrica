import { randomUUID } from "node:crypto";
import { formatMoney, isLocale, type Locale, messages } from "@duoshop/i18n";
import {
  getCart,
  getCheckout,
  getDeliveryZones,
  quoteCheckout,
} from "@duoshop/sdk";
import type { DeliveryMethodDTO, MoneyDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, shopper, webOrigin } from "../../../lib/session";
import { AddressFields } from "../account/addresses/address-fields";
import { ShopShell } from "../shop-shell";
import { addAddressAction, placeOrderAction } from "./actions";

const money = (m: MoneyDTO, locale: Locale) =>
  formatMoney(BigInt(m.amountMinor), m.currency, locale);

// Deux étapes sans JavaScript : (1) choix par formulaire GET, (2) devis serveur puis confirmation.
export default async function Checkout({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const c = t.checkout;
  const credentials = await shopper();
  const token = credentials.session;
  // La connexion fusionne le panier visiteur dans celui du compte (côté API).
  const data = token ? await getCheckout(apiUrl, credentials) : null;
  if (!token || !data?.ok) {
    // Visiteur : le panier est conservé ; le compte est créé ou ouvert maintenant.
    const guestCart = await getCart(apiUrl, credentials);
    const total = guestCart.ok ? guestCart.data.total : null;
    const count = guestCart.ok ? guestCart.data.itemCount : 0;
    return (
      <ShopShell locale={locale} path="/checkout">
        <h1>{c.title}</h1>
        {count === 0 || !total ? (
          <p>
            {c.errors.cart_empty}{" "}
            <Link href={`/${locale}/products`}>{t.shop.browseAll}</Link>
          </p>
        ) : (
          <section className="panel" aria-labelledby="account-step">
            <h2 id="account-step">{c.accountStep}</h2>
            <p>
              {count} {c.articles} · <strong>{money(total, locale)}</strong>{" "}
              {c.beforeDelivery}
            </p>
            <p>{c.accountWhy}</p>
            <a
              className="cta"
              href={`/v1/auth/login?${new URLSearchParams({ returnTo: `/${locale}/checkout`, locale })}`}
            >
              {c.accountCta}
            </a>
            <p className="hint">{c.cartKept}</p>
          </section>
        )}
      </ShopShell>
    );
  }
  const { cart, options, addresses } = data.data;
  if (cart.groups.length === 0)
    return (
      <ShopShell locale={locale} path="/checkout">
        <h1>{c.title}</h1>
        <p>
          {c.errors.cart_empty}{" "}
          <Link href={`/${locale}/products`}>{t.shop.browseAll}</Link>
        </p>
      </ShopShell>
    );
  const chosen = options.map((o) => {
    const requested = query[`d_${o.store.slug}`];
    const method: DeliveryMethodDTO | null =
      requested === "HOME_DELIVERY" && o.homeDelivery
        ? "HOME_DELIVERY"
        : requested === "PICKUP" && o.pickup
          ? "PICKUP"
          : null;
    return { option: o, method };
  });
  const addressId = addresses.some((a) => a.id === query.address)
    ? query.address
    : undefined;
  const complete = chosen.every((c) => c.method !== null);
  const deliveries = chosen.flatMap((c) =>
    c.method ? [{ storeSlug: c.option.store.slug, method: c.method }] : [],
  );
  const quote = complete
    ? await quoteCheckout(apiUrl, token, webOrigin, {
        deliveries,
        ...(addressId ? { addressId } : {}),
      })
    : null;
  const errors = c.errors;
  const errorCode =
    query.error ?? (quote && !quote.ok ? quote.error : undefined);
  const currentQuery = `?${new URLSearchParams(
    Object.entries(query).filter(
      (entry): entry is [string, string] =>
        entry[0] !== "error" && typeof entry[1] === "string",
    ),
  )}`;
  return (
    <ShopShell locale={locale} path="/checkout">
      <h1>{c.title}</h1>
      {errorCode && (
        <Notice>
          {errorCode in errors
            ? errors[errorCode as keyof typeof errors]
            : errors.unknown}
        </Notice>
      )}
      <form method="get" action={`/${locale}/checkout`} className="stack">
        {chosen.map(({ option, method }) => (
          <fieldset key={option.store.slug} className="panel">
            <legend>
              {t.shop.soldBy} {option.store.name} — {c.delivery}
            </legend>
            {option.homeDelivery && (
              <label className="variant-choice">
                <input
                  type="radio"
                  name={`d_${option.store.slug}`}
                  value="HOME_DELIVERY"
                  defaultChecked={method === "HOME_DELIVERY"}
                  required
                />
                <span>{c.home}</span>
                <strong>
                  {option.homeDelivery.byZone && `${c.byZone} `}
                  {option.homeDelivery.fee.amountMinor === "0"
                    ? c.free
                    : money(option.homeDelivery.fee, locale)}
                </strong>
              </label>
            )}
            {option.pickup && (
              <label className="variant-choice">
                <input
                  type="radio"
                  name={`d_${option.store.slug}`}
                  value="PICKUP"
                  defaultChecked={method === "PICKUP"}
                  required
                />
                <span>{c.pickup}</span>
                {option.pickup.instructions && (
                  <span className="hint">{option.pickup.instructions}</span>
                )}
              </label>
            )}
          </fieldset>
        ))}
        <label>
          {c.address}
          <select name="address" defaultValue={addressId ?? ""}>
            <option value="">—</option>
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.district}, {a.landmark}
              </option>
            ))}
          </select>
        </label>
        {addresses.length === 0 && <p className="hint">{c.noAddress}</p>}
        <p className="hint">{c.pickupNoAddress}</p>
        <button type="submit" className="secondary">
          {c.compute}
        </button>
      </form>

      {chosen.some((x) => x.method !== "PICKUP") && (
        <details className="panel" open={addresses.length === 0}>
          <summary>{c.newAddress}</summary>
          <form action={addAddressAction} className="stack">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="query" value={currentQuery} />
            <AddressFields
              locale={locale}
              zones={await getDeliveryZones(apiUrl)}
            />
            <button type="submit" className="cta">
              {c.useAddress}
            </button>
          </form>
        </details>
      )}

      {quote?.ok && (
        <section className="panel" aria-labelledby="quote">
          <h2 id="quote">{c.total}</h2>
          <dl className="facts">
            <dt>{c.items}</dt>
            <dd>{money(quote.data.itemsTotal, locale)}</dd>
            <dt>{c.deliveryTotal}</dt>
            <dd>{money(quote.data.deliveryTotal, locale)}</dd>
            <dt>{c.total}</dt>
            <dd>
              <strong>{money(quote.data.total, locale)}</strong>
            </dd>
          </dl>
          <Notice>{c.paymentNotice}</Notice>
          <form action={placeOrderAction}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="query" value={currentQuery} />
            {/* Clé fixée au rendu : un double envoi de ce formulaire ne crée qu'une commande. */}
            <input
              type="hidden"
              name="idempotencyKey"
              value={randomUUID().replaceAll("-", "")}
            />
            <input
              type="hidden"
              name="deliveries"
              value={JSON.stringify(deliveries)}
            />
            <input type="hidden" name="addressId" value={addressId ?? ""} />
            <input
              type="hidden"
              name="expectedTotalMinor"
              value={quote.data.total.amountMinor}
            />
            <button type="submit" className="cta">
              {c.confirm}
            </button>
          </form>
        </section>
      )}
    </ShopShell>
  );
}
