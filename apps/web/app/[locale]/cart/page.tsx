import { formatMoney, isLocale, type Locale, messages } from "@duoshop/i18n";
import { getCart } from "@duoshop/sdk";
import type { CartLineDTO, MoneyDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, shopper } from "../../../lib/session";
import { ShopShell } from "../shop-shell";
import { setLineAction } from "./actions";

const money = (m: MoneyDTO, locale: Locale) =>
  formatMoney(BigInt(m.amountMinor), m.currency, locale);

function LineForm({
  locale,
  line,
  label,
  quantity,
}: {
  locale: Locale;
  line: CartLineDTO;
  label: string;
  quantity?: number;
}) {
  return (
    <form action={setLineAction} className="line-form">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="back" value={`/${locale}/cart`} />
      <input type="hidden" name="variantId" value={line.variantId} />
      {quantity === undefined ? (
        <label>
          <span className="visually-hidden">
            {messages[locale].shop.quantity}
          </span>
          <input
            name="quantity"
            type="number"
            inputMode="numeric"
            min={1}
            max={99}
            defaultValue={line.quantity}
            required
          />
        </label>
      ) : (
        <input type="hidden" name="quantity" value={quantity} />
      )}
      <button type="submit" className="secondary">
        {label}
      </button>
    </form>
  );
}

export default async function Cart({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const s = t.shop;
  const credentials = await shopper();
  const cart = await getCart(apiUrl, credentials);
  if (!cart.ok)
    return (
      <ShopShell locale={locale} path="/cart">
        <h1>{s.cart}</h1>
        <Notice>{s.errors.unknown}</Notice>
      </ShopShell>
    );
  const { groups, unavailable, total } = cart.data;
  const errors = s.errors;
  return (
    <ShopShell locale={locale} path="/cart">
      <h1>{s.cart}</h1>
      {query.error && (
        <Notice>
          {query.error in errors
            ? errors[query.error as keyof typeof errors]
            : errors.unknown}
        </Notice>
      )}
      {groups.length === 0 && unavailable.length === 0 ? (
        <p>
          {s.cartEmpty} <Link href={`/${locale}/products`}>{s.browseAll}</Link>
        </p>
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.store.slug} className="panel">
              <h2>
                {s.soldBy} {group.store.name}
              </h2>
              <ul className="cart-lines">
                {group.lines.map((line) => (
                  <li key={line.variantId}>
                    <div>
                      <Link href={`/${locale}/products/${line.productId}`}>
                        {line.title}
                      </Link>{" "}
                      — {line.label}
                      <br />
                      {line.unitPrice && money(line.unitPrice, locale)}
                      {line.previousUnitPrice && (
                        <>
                          {" "}
                          <s>
                            {s.was} {money(line.previousUnitPrice, locale)}
                          </s>
                        </>
                      )}
                      {line.status !== "ok" && (
                        <p className="line-status" role="status">
                          {s.lineStatus[line.status]}
                        </p>
                      )}
                    </div>
                    <div className="line-actions">
                      <LineForm locale={locale} line={line} label={s.update} />
                      <LineForm
                        locale={locale}
                        line={line}
                        label={s.remove}
                        quantity={0}
                      />
                    </div>
                    <strong>
                      {line.lineTotal && money(line.lineTotal, locale)}
                    </strong>
                  </li>
                ))}
              </ul>
              <p className="subtotal">
                {s.subtotal} : <strong>{money(group.subtotal, locale)}</strong>
              </p>
            </section>
          ))}
          {unavailable.length > 0 && (
            <section className="panel">
              <h2>{s.unavailableTitle}</h2>
              <ul className="cart-lines">
                {unavailable.map((line) => (
                  <li key={line.variantId}>
                    <span>{s.unavailableLine}</span>
                    <LineForm
                      locale={locale}
                      line={line}
                      label={s.remove}
                      quantity={0}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="total">
            {s.total} : <strong>{money(total, locale)}</strong>
          </p>
          <p>
            <Link className="cta" href={`/${locale}/checkout`}>
              {t.checkout.start}
            </Link>
          </p>
          {!credentials.session && <p className="hint">{s.guestHint}</p>}
        </>
      )}
    </ShopShell>
  );
}
