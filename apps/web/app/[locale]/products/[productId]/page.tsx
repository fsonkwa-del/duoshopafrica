import { formatMoney, isLocale, messages } from "@duoshop/i18n";
import { getCatalogProduct } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl } from "../../../../lib/session";
import { setLineAction } from "../../cart/actions";
import { ShopShell } from "../../shop-shell";

export default async function ProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; productId: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale, productId } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const s = messages[locale].shop;
  const product = await getCatalogProduct(apiUrl, productId, locale);
  if (!product) notFound();
  const path = `/products/${product.id}`;
  const errors = s.errors;
  const firstAvailable = product.variants.find(
    (v) => v.availability !== "out_of_stock",
  );
  return (
    <ShopShell locale={locale} path={path}>
      <article className="product">
        <div className="gallery">
          {product.media.length === 0 ? (
            <div className="image-placeholder" aria-hidden="true">
              {s.noImage}
            </div>
          ) : (
            product.media.map((m) => (
              <img
                key={m.url}
                src={m.url}
                alt={m.alt}
                width={m.width ?? undefined}
                height={m.height ?? undefined}
                decoding="async"
              />
            ))
          )}
        </div>
        <div>
          <h1>{product.title}</h1>
          <p className="meta">
            {s.soldBy} {product.store.name}
          </p>
          {product.description && <p>{product.description}</p>}
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
              <legend>{s.choose}</legend>
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
                  <strong>
                    {formatMoney(
                      BigInt(variant.price.amountMinor),
                      variant.price.currency,
                      locale,
                    )}
                  </strong>
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
            <button type="submit" className="cta" disabled={!firstAvailable}>
              {s.addToCart}
            </button>
          </form>
        </div>
      </article>
    </ShopShell>
  );
}
