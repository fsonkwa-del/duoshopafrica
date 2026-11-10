import { formatMoney, isLocale, type Locale, messages } from "@duoshop/i18n";
import { getCatalogProduct, searchCatalog } from "@duoshop/sdk";
import type { MoneyDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl } from "../../../../lib/session";
import { setLineAction } from "../../cart/actions";
import { ProductGrid } from "../../product-grid";
import { SellerLegal } from "../../seller-legal";
import { ShopShell } from "../../shop-shell";

const money = (m: MoneyDTO, locale: Locale) =>
  formatMoney(BigInt(m.amountMinor), m.currency, locale);

// Fiche produit « place de marché » : galerie à miniatures, bloc d'achat (prix, options,
// quantité, panier ou achat immédiat), encadré vendeur et garanties, puis caractéristiques,
// description et produits similaires. Entièrement utilisable sans JavaScript.
export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; productId: string }>;
  searchParams: Promise<{ ok?: string; error?: string; photo?: string }>;
}) {
  const { locale, productId } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const s = t.shop;
  const d = t.pdp;
  const product = await getCatalogProduct(apiUrl, productId, locale);
  if (!product) notFound();
  const path = `/products/${product.id}`;
  const errors = s.errors;
  const firstAvailable = product.variants.find(
    (v) => v.availability !== "out_of_stock",
  );
  // Montants en BigInt : tri explicite (Math.min/max ne les acceptent pas).
  const prices = product.variants
    .map((v) => BigInt(v.price.amountMinor))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const low = prices[0] ?? 0n;
  const high = prices[prices.length - 1] ?? low;
  const currency = product.variants[0]?.price.currency ?? "XAF";
  const photo = Math.min(
    Math.max(Number.parseInt(query.photo ?? "0", 10) || 0, 0),
    Math.max(product.media.length - 1, 0),
  );
  const main = product.media[photo];
  const similar = product.category
    ? (
        await searchCatalog(apiUrl, {
          lang: locale,
          category: product.category.slug,
        }).catch(() => ({ items: [] }))
      ).items
        .filter((i) => i.id !== product.id)
        .slice(0, 8)
    : [];
  const stock = firstAvailable
    ? s.availability[
        product.variants.some((v) => v.availability === "in_stock")
          ? "in_stock"
          : "low_stock"
      ]
    : s.availability.out_of_stock;
  return (
    <ShopShell locale={locale} path={path}>
      {product.category && (
        <nav aria-label={t.categories.title} className="breadcrumb">
          <Link href={`/${locale}`}>{t.categories.home}</Link> ›{" "}
          {product.category.parent && (
            <>
              <Link
                href={`/${locale}/products?${new URLSearchParams({ category: product.category.parent.slug })}`}
              >
                {product.category.parent.name}
              </Link>{" "}
              ›{" "}
            </>
          )}
          <Link
            href={`/${locale}/products?${new URLSearchParams({ category: product.category.slug })}`}
          >
            {product.category.name}
          </Link>
        </nav>
      )}
      <article className="pdp">
        <div className="pdp-gallery">
          {main ? (
            <img
              className="pdp-main"
              src={main.url}
              alt={main.alt}
              width={main.width ?? undefined}
              height={main.height ?? undefined}
              decoding="async"
            />
          ) : (
            <div className="image-placeholder pdp-main" aria-hidden="true">
              {s.noImage}
            </div>
          )}
          {product.media.length > 1 && (
            <ul className="pdp-thumbs">
              {product.media.map((m, i) => (
                <li key={m.url}>
                  <Link
                    href={`/${locale}${path}?photo=${i}`}
                    aria-current={i === photo ? "true" : undefined}
                    aria-label={`${d.photo} ${i + 1}`}
                    scroll={false}
                  >
                    <img src={m.url} alt="" width={64} height={64} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="pdp-buy">
          <h1>{product.title}</h1>
          <p className="meta">
            {s.soldBy} <strong>{product.store.name}</strong> · {d.verified}
          </p>
          <div className="price-block">
            <span className="meta">{low === high ? d.perUnit : d.from}</span>{" "}
            <span className="price-big">
              {formatMoney(low, currency, locale)}
              {low !== high && ` – ${formatMoney(high, currency, locale)}`}
            </span>
            <br />
            <span className="meta">{t.legal.pricesNote}</span>
          </div>
          {query.ok === "added" && <Notice>{s.added}</Notice>}
          {query.error && (
            <Notice>
              {query.error in errors
                ? errors[query.error as keyof typeof errors]
                : errors.unknown}
            </Notice>
          )}
          <form action={setLineAction} className="stack">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="back" value={`/${locale}${path}`} />
            <fieldset className="variants">
              <legend>
                {s.choose} ({product.variants.length} {d.options})
              </legend>
              {product.variants.map((variant) => (
                <label key={variant.id} className="variant-choice">
                  <input
                    type="radio"
                    name="variantId"
                    value={variant.id}
                    required
                    disabled={variant.availability === "out_of_stock"}
                    defaultChecked={variant.id === firstAvailable?.id}
                  />
                  <span>{variant.label}</span>
                  <strong>{money(variant.price, locale)}</strong>
                  <span className={`availability ${variant.availability}`}>
                    {s.availability[variant.availability]}
                  </span>
                </label>
              ))}
            </fieldset>
            <label>
              {s.quantity}
              <input
                name="quantity"
                type="number"
                inputMode="numeric"
                min={1}
                max={99}
                step={1}
                defaultValue={1}
                required
              />
            </label>
            <div className="pdp-actions">
              <button
                type="submit"
                name="intent"
                value="buy"
                className="cta"
                disabled={!firstAvailable}
              >
                {d.buyNow}
              </button>
              <button
                type="submit"
                name="intent"
                value="cart"
                className="secondary"
                disabled={!firstAvailable}
              >
                {s.addToCart}
              </button>
            </div>
          </form>
        </div>

        <aside className="pdp-side">
          <section className="panel" aria-labelledby="seller">
            <h2 id="seller">{d.seller}</h2>
            <p>
              <strong>{product.store.name}</strong>
              <br />
              <span className="badge">✓ {d.verified}</span>
              <br />
              <span className="meta">
                {d.since} {product.seller.since}
              </span>
            </p>
            <ul className="facts-list">
              <li>
                {d.homeDelivery} :{" "}
                {product.seller.homeDelivery?.byZone && `${t.checkout.byZone} `}
                {product.seller.homeDelivery
                  ? product.seller.homeDelivery.fee.amountMinor === "0"
                    ? t.checkout.free
                    : money(product.seller.homeDelivery.fee, locale)
                  : d.noDelivery}
              </li>
              {product.seller.pickup && (
                <li>
                  {d.pickup}
                  {product.seller.pickup.instructions
                    ? ` : ${product.seller.pickup.instructions}`
                    : ""}
                </li>
              )}
            </ul>
            <details>
              <summary>{t.legal.mentionsTitle}</summary>
              <SellerLegal locale={locale} legal={product.seller.legal} />
            </details>
            {product.category && (
              <p>
                <Link
                  href={`/${locale}/products?${new URLSearchParams({ category: product.category.slug })}`}
                >
                  {d.seeStore}
                </Link>
              </p>
            )}
          </section>
          <section className="panel" aria-labelledby="guarantees">
            <h2 id="guarantees">{d.guarantees}</h2>
            <ul className="trust">
              {d.guaranteeList.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </section>
        </aside>
      </article>

      <section className="panel" aria-labelledby="specs">
        <h2 id="specs">{d.specs}</h2>
        <dl className="specs">
          {product.category && (
            <>
              <dt>{d.category}</dt>
              <dd>
                {product.category.parent
                  ? `${product.category.parent.name} › `
                  : ""}
                {product.category.name}
              </dd>
            </>
          )}
          <dt>{d.seller}</dt>
          <dd>{product.store.name}</dd>
          <dt>{d.variants}</dt>
          <dd>{product.variants.map((v) => v.label).join(", ")}</dd>
          <dt>{d.availability}</dt>
          <dd>{stock}</dd>
          <dt>{d.homeDelivery}</dt>
          <dd>
            {product.seller.homeDelivery
              ? money(product.seller.homeDelivery.fee, locale)
              : d.noDelivery}
          </dd>
        </dl>
      </section>

      <section className="panel" aria-labelledby="description">
        <h2 id="description">{d.description}</h2>
        <p className="pdp-description">
          {product.description ?? d.noDescription}
        </p>
      </section>

      {similar.length > 0 && (
        <section aria-labelledby="similar">
          <h2 id="similar">{d.similar}</h2>
          <ProductGrid locale={locale} items={similar} />
        </section>
      )}
    </ShopShell>
  );
}
