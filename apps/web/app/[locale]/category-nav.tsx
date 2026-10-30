import { type Locale, messages } from "@duoshop/i18n";
import { getCategories } from "@duoshop/sdk";
import type { CategoryDTO } from "@duoshop/types";
import Link from "next/link";
import { apiUrl } from "../../lib/session";

// Rubriques de la place de marché : colonne latérale sur grand écran, bandeau défilant sur
// mobile. Sans JavaScript : la rubrique ouverte affiche ses sous-catégories.
export async function CategoryNav({
  locale,
  current,
}: {
  locale: Locale;
  current?: string | undefined;
}) {
  const t = messages[locale].categories;
  const categories = await getCategories(apiUrl, locale).catch(
    () => [] as CategoryDTO[],
  );
  const open = categories.find(
    (c) => c.slug === current || c.children.some((s) => s.slug === current),
  );
  const href = (slug: string) =>
    `/${locale}/products?${new URLSearchParams({ category: slug })}`;
  return (
    <nav aria-label={t.title} className="category-nav">
      <h2 className="visually-hidden">{t.title}</h2>
      <ul>
        <li>
          <Link
            href={`/${locale}/products`}
            aria-current={!current ? "page" : undefined}
          >
            {t.all}
          </Link>
        </li>
        {categories.map((c) => (
          <li key={c.id}>
            <Link
              href={href(c.slug)}
              aria-current={c.slug === current ? "page" : undefined}
            >
              {c.name} <span className="meta">({c.productCount})</span>
            </Link>
            {open?.id === c.id && c.children.length > 0 && (
              <ul className="subcategories">
                {c.children.map((s) => (
                  <li key={s.id}>
                    <Link
                      href={href(s.slug)}
                      aria-current={s.slug === current ? "page" : undefined}
                    >
                      {s.name} <span className="meta">({s.productCount})</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </nav>
  );
}

// Choix de catégorie (formulaires vendeur), groupé par rubrique, avec son libellé.
export function CategorySelect({
  locale,
  categories,
  value,
}: {
  locale: Locale;
  categories: CategoryDTO[];
  value?: string | null;
}) {
  const t = messages[locale].categories;
  return (
    <label>
      {t.label}
      <select name="categoryId" defaultValue={value ?? ""}>
        <option value="">{t.none}</option>
        {categories.map((c) => (
          <optgroup key={c.id} label={c.name}>
            <option value={c.id}>{c.name}</option>
            {c.children.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
