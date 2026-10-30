import { isLocale, messages } from "@duoshop/i18n";
import { getCategories, searchCatalog } from "@duoshop/sdk";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl } from "../../../lib/session";
import { CategoryNav } from "../category-nav";
import { ProductGrid } from "../product-grid";
import { ShopShell } from "../shop-shell";

const slugPattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export default async function Products({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string; category?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const q = (query.q ?? "").slice(0, 100).trim();
  const category =
    query.category && slugPattern.test(query.category)
      ? query.category
      : undefined;
  const page = Math.min(
    Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1),
    50,
  );
  const t = messages[locale];
  const s = t.shop;
  const [result, categories] = await Promise.all([
    searchCatalog(apiUrl, {
      q,
      page,
      lang: locale,
      ...(category ? { category } : {}),
    }),
    category ? getCategories(apiUrl, locale).catch(() => []) : [],
  ]);
  // Fil d'Ariane : rubrique et, le cas échéant, sous-catégorie sélectionnée.
  const root = categories.find(
    (c) => c.slug === category || c.children.some((x) => x.slug === category),
  );
  const leaf =
    root && root.slug !== category
      ? root.children.find((x) => x.slug === category)
      : undefined;
  const filters = {
    ...(q ? { q } : {}),
    ...(category ? { category } : {}),
  };
  const pageLink = (target: number) =>
    `/${locale}/products?${new URLSearchParams({ ...filters, page: String(target) })}`;
  const path = `/products${Object.keys(filters).length ? `?${new URLSearchParams(filters)}` : ""}`;
  const heading = q
    ? `${s.resultsFor} « ${q} »`
    : (leaf?.name ?? root?.name ?? s.results);
  return (
    <ShopShell locale={locale} path={path} query={q}>
      <div className="with-sidebar">
        <CategoryNav locale={locale} current={category} />
        <div>
          {root && (
            <nav aria-label={t.categories.title} className="breadcrumb">
              <Link href={`/${locale}`}>{t.categories.home}</Link> ›{" "}
              {leaf ? (
                <>
                  <Link
                    href={`/${locale}/products?${new URLSearchParams({ category: root.slug })}`}
                  >
                    {root.name}
                  </Link>{" "}
                  › <span aria-current="page">{leaf.name}</span>
                </>
              ) : (
                <span aria-current="page">{root.name}</span>
              )}
            </nav>
          )}
          <h1>{heading}</h1>
          {result.items.length === 0 ? (
            <p>{s.noResults}</p>
          ) : (
            <ProductGrid locale={locale} items={result.items} />
          )}
          <nav aria-label="Pagination" className="pagination">
            {result.page > 1 && (
              <Link href={pageLink(result.page - 1)}>{s.previous}</Link>
            )}
            {result.hasMore && (
              <Link href={pageLink(result.page + 1)}>{s.next}</Link>
            )}
          </nav>
        </div>
      </div>
    </ShopShell>
  );
}
