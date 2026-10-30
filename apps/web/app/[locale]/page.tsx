import { formatMoney, isLocale, type Locale, messages } from "@duoshop/i18n";
import { getCategories, searchCatalog } from "@duoshop/sdk";
import type { CatalogItemDTO, CategoryDTO } from "@duoshop/types";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl } from "../../lib/session";
import {
  CategoryIcon,
  ChevronIcon,
  PinIcon,
  SearchIcon,
  ShieldIcon,
  StoreIcon,
} from "./icons";
import { ProductGrid } from "./product-grid";
import { PromoCarousel, type Slide } from "./promo-carousel";
import { ShopShell } from "./shop-shell";

// Carte « Explorez » : titre, image du premier produit et prix en pastille.
function ExploreCard({
  locale,
  href,
  title,
  subtitle,
  item,
}: {
  locale: Locale;
  href: string;
  title: string;
  subtitle?: string;
  item: CatalogItemDTO | undefined;
}) {
  const s = messages[locale].shop;
  return (
    <Link href={href} className="explore-card">
      <span className="explore-title">{title}</span>
      {subtitle && <span className="explore-subtitle">{subtitle}</span>}
      <span className="explore-media">
        {item?.image ? (
          <img src={item.image.url} alt="" loading="lazy" decoding="async" />
        ) : (
          <span className="image-placeholder">{s.noImage}</span>
        )}
        {item && (
          <span className="price-pill">
            {formatMoney(
              BigInt(item.priceFrom.amountMinor),
              item.priceFrom.currency,
              locale,
            )}
          </span>
        )}
      </span>
    </Link>
  );
}

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const h = t.home;
  const [catalog, categories] = await Promise.all([
    searchCatalog(apiUrl, { lang: locale }),
    getCategories(apiUrl, locale).catch(() => [] as CategoryDTO[]),
  ]);
  // Deux rubriques les mieux fournies, avec leur premier produit.
  const featured = categories
    .filter((c) => c.productCount > 0)
    .sort((a, b) => b.productCount - a.productCount)
    .slice(0, 2);
  const explore = await Promise.all(
    featured.map(async (c) => ({
      category: c,
      item: (
        await searchCatalog(apiUrl, { lang: locale, category: c.slug }).catch(
          () => ({ items: [] }),
        )
      ).items[0],
    })),
  );
  const slides: Slide[] = h.slides.map((slide, i) => ({
    ...slide,
    href: i === 2 ? `/${locale}/account` : `/${locale}/products`,
    tone: (["red", "orange", "plum"] as const)[i] ?? "red",
    icon: ["📱", "🛍️", "🏪"][i] ?? "🛍️",
  }));
  const categoryHref = (slug: string) =>
    `/${locale}/products?${new URLSearchParams({ category: slug })}`;
  return (
    <ShopShell locale={locale} path="" variant="home">
      <section className="home-hero" aria-label={t.shop.search}>
        <div className="hero-tabs">
          <span className="hero-tab active" aria-current="true">
            {h.tabProducts}
          </span>
          <a className="hero-tab" href="#categories">
            {h.tabCategories}
          </a>
        </div>
        <search>
          <form
            action={`/${locale}/products`}
            method="get"
            className="big-search"
          >
            <label htmlFor="home-q" className="visually-hidden">
              {t.shop.search}
            </label>
            <input
              id="home-q"
              name="q"
              type="search"
              maxLength={100}
              placeholder={h.searchPlaceholder}
            />
            <div className="big-search-bar">
              <span className="meta">{h.searchHint}</span>
              <button type="submit" className="gradient-button">
                <SearchIcon /> {h.searchButton}
              </button>
            </div>
          </form>
        </search>
      </section>

      <div className="welcome-bar">
        <h1>{h.welcome}</h1>
        <ul className="quick-links">
          <li>
            <ShieldIcon /> {h.quickMobileMoney}
          </li>
          <li>
            <PinIcon /> {h.quickPickup}
          </li>
          <li>
            <Link href={`/${locale}/account`}>
              <StoreIcon /> {h.quickSell}
            </Link>
          </li>
        </ul>
      </div>

      <div className="home-row">
        <nav
          aria-label={t.categories.title}
          className="cat-panel"
          id="categories"
        >
          <ul>
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={categoryHref(c.slug)}>
                  <CategoryIcon slug={c.slug} />
                  <span>{c.name}</span>
                  <ChevronIcon />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ExploreCard
          locale={locale}
          href={`/${locale}/products`}
          title={h.latest}
          item={catalog.items[0]}
        />
        {explore.map(({ category, item }) => (
          <ExploreCard
            key={category.id}
            locale={locale}
            href={categoryHref(category.slug)}
            title={h.explore}
            subtitle={category.name}
            item={item}
          />
        ))}
        <PromoCarousel
          slides={slides}
          labels={{
            region: h.slidesLabel,
            previous: h.previous,
            next: h.next,
            goTo: h.goTo,
          }}
        />
      </div>

      <section aria-labelledby="for-you">
        <div className="section-head">
          <h2 id="for-you">{h.forYou}</h2>
          <Link href={`/${locale}/products`}>{h.seeAll}</Link>
        </div>
        {catalog.items.length === 0 ? (
          <p>{h.empty}</p>
        ) : (
          <ProductGrid locale={locale} items={catalog.items} />
        )}
      </section>
    </ShopShell>
  );
}
