import { isLocale, messages } from "@duoshop/i18n";
import { searchCatalog } from "@duoshop/sdk";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl } from "../../lib/session";
import { ProductGrid } from "./product-grid";
import { ShopShell } from "./shop-shell";

// Accueil « place de marché » : les articles sont visibles et ajoutables au panier
// sans compte ; le compte n'est demandé qu'au passage de commande.
export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const h = t.home;
  const catalog = await searchCatalog(apiUrl, { lang: locale });
  return (
    <ShopShell locale={locale} path="">
      <section className="home-banner" aria-labelledby="banner-title">
        <div className="banner-main">
          <h1 id="banner-title">{h.bannerTitle}</h1>
          <p>{h.bannerText}</p>
          <Link className="cta banner-cta" href={`/${locale}/products`}>
            {h.shopNow}
          </Link>
        </div>
        <aside className="banner-side">
          <ul className="trust">
            {h.trust.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <div className="sell">
            <h2>{h.sellTitle}</h2>
            <p>{h.sellText}</p>
            <Link href={`/${locale}/account`}>{h.sellCta}</Link>
          </div>
        </aside>
      </section>
      <section aria-labelledby="latest">
        <div className="section-head">
          <h2 id="latest">{h.latest}</h2>
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
