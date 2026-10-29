import { formatMoney, type Locale, messages } from "@duoshop/i18n";
import type { CatalogItemDTO } from "@duoshop/types";
import Link from "next/link";

// Grille produits partagée (accueil, catalogue, recherche).
export function ProductGrid({
  locale,
  items,
}: {
  locale: Locale;
  items: CatalogItemDTO[];
}) {
  const s = messages[locale].shop;
  return (
    <ul className="product-grid">
      {items.map((item) => (
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
          <p className="meta">
            {s.soldBy} {item.store.name}
          </p>
          <p className="price">
            {s.from}{" "}
            {formatMoney(
              BigInt(item.priceFrom.amountMinor),
              item.priceFrom.currency,
              locale,
            )}
          </p>
          <p className={`availability ${item.availability}`}>
            {s.availability[item.availability]}
          </p>
        </li>
      ))}
    </ul>
  );
}
