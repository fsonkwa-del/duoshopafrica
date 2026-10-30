import { formatMoney, type Locale, messages } from "@duoshop/i18n";
import type { CatalogItemDTO } from "@duoshop/types";
import Link from "next/link";

// Carte produit « place de marché » : grande image, titre sur deux lignes, fourchette de prix,
// commande minimale et ventes, vendeur vérifié avec ancienneté. Toute la carte est cliquable.
export function ProductGrid({
  locale,
  items,
}: {
  locale: Locale;
  items: CatalogItemDTO[];
}) {
  const s = messages[locale].shop;
  const k = messages[locale].card;
  const thisYear = new Date().getUTCFullYear();
  const price = (item: CatalogItemDTO) => {
    const from = formatMoney(
      BigInt(item.priceFrom.amountMinor),
      item.priceFrom.currency,
      locale,
    );
    return item.priceTo.amountMinor === item.priceFrom.amountMinor
      ? from
      : `${from} – ${formatMoney(BigInt(item.priceTo.amountMinor), item.priceTo.currency, locale)}`;
  };
  return (
    <ul className="product-grid">
      {items.map((item) => {
        const years = thisYear - item.storeSince;
        return (
          <li key={item.id} className="product-card">
            {item.image ? (
              <img
                src={item.image.url}
                alt={item.image.alt}
                width={item.image.width ?? undefined}
                height={item.image.height ?? undefined}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <div className="image-placeholder" aria-hidden="true">
                {s.noImage}
              </div>
            )}
            <h2>
              <Link href={`/${locale}/products/${item.id}`}>{item.title}</Link>
            </h2>
            <p className={`availability ${item.availability}`}>
              ✓ {s.availability[item.availability]}
            </p>
            <p className="price">{price(item)}</p>
            <p className="card-meta">
              {k.minOrder}
              {item.sold > 0 && (
                <span className="meta">
                  {" "}
                  {item.sold} {k.sold}
                </span>
              )}
            </p>
            <p className="card-seller">
              <span className="verified">✓ {k.verified}</span>
              <span className="meta">
                {" · "}
                {years < 1
                  ? k.newStore
                  : `${years} ${years === 1 ? k.year : k.years}`}
                {" · CM · "}
                {item.store.name}
              </span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
