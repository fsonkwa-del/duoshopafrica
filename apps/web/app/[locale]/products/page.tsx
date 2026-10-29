import { isLocale, messages } from "@duoshop/i18n";
import { searchCatalog } from "@duoshop/sdk";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl } from "../../../lib/session";
import { ProductGrid } from "../product-grid";
import { ShopShell } from "../shop-shell";

export default async function Products({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const q = (query.q ?? "").slice(0, 100).trim();
  const page = Math.min(
    Math.max(Number.parseInt(query.page ?? "1", 10) || 1, 1),
    50,
  );
  const s = messages[locale].shop;
  const result = await searchCatalog(apiUrl, { q, page, lang: locale });
  const pageLink = (target: number) =>
    `/${locale}/products?${new URLSearchParams({ ...(q ? { q } : {}), page: String(target) })}`;
  const path = `/products${q ? `?${new URLSearchParams({ q })}` : ""}`;
  return (
    <ShopShell locale={locale} path={path} query={q}>
      <h1>{q ? `${s.resultsFor} « ${q} »` : s.results}</h1>
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
    </ShopShell>
  );
}
