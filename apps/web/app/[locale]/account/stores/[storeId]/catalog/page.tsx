import { randomUUID } from "node:crypto";
import { formatMoney, isLocale, messages } from "@duoshop/i18n";
import { getCategories, getStore, listProducts } from "@duoshop/sdk";
import type { ProductStatusDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../../../lib/session";
import { SellerNav } from "../../../../admin/admin-nav";
import { CategorySelect } from "../../../../category-nav";
import { AccountShell, SignIn } from "../../../account-shell";
import {
  changeCategoryAction,
  changePriceAction,
  changeStatusAction,
  createProductAction,
  moveStockAction,
} from "./actions";
import { PhotoUpload } from "./photo-upload";

const nextStatuses: Record<ProductStatusDTO, readonly ProductStatusDTO[]> = {
  DRAFT: ["PUBLISHED", "ARCHIVED"],
  PUBLISHED: ["DRAFT", "ARCHIVED"],
  ARCHIVED: ["DRAFT"],
};

export default async function Catalog({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; storeId: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const { locale, storeId } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const c = t.catalog;
  const path = `/account/stores/${storeId}/catalog`;
  const token = await sessionToken();
  const [store, catalog, categories] = token
    ? await Promise.all([
        getStore(apiUrl, token, storeId),
        listProducts(apiUrl, token, storeId),
        getCategories(apiUrl, locale).catch(() => []),
      ])
    : [null, null, []];
  if (!store || !catalog || (!store.ok && store.status === 401))
    return <SignIn locale={locale} path={path} />;
  const back = (
    <p>
      <Link href={`/${locale}/account/stores/${storeId}`}>{t.backToStore}</Link>
    </p>
  );
  if (!store.ok || !catalog.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        {back}
        <Notice>
          {!store.ok && store.status === 403
            ? t.storeUnavailable
            : t.storeNotFound}
        </Notice>
      </AccountShell>
    );
  const errors = c.errors;
  const error =
    query.error &&
    (query.error in errors
      ? errors[query.error as keyof typeof errors]
      : errors.unknown);
  const canPublish = store.data.tenantStatus === "ACTIVE";
  const hidden = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="storeId" value={storeId} />
    </>
  );
  const statusLabel = (status: ProductStatusDTO, from: ProductStatusDTO) =>
    status === "PUBLISHED"
      ? c.publish
      : status === "ARCHIVED"
        ? c.archive
        : from === "ARCHIVED"
          ? c.restore
          : c.unpublish;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <SellerNav locale={locale} storeId={storeId} current={path} />
      {back}
      <h1>
        {c.title} — {store.data.name}
      </h1>
      {store.data.tenantStatus === "PENDING" && (
        <Notice>{c.pendingNotice}</Notice>
      )}
      {query.ok === "created" && <Notice>{c.created}</Notice>}
      {query.ok === "saved" && <Notice>{c.saved}</Notice>}
      {query.ok === "category" && <Notice>{t.categories.changed}</Notice>}
      {query.ok === "replayed" && <Notice>{c.replayed}</Notice>}
      {error && <Notice>{error}</Notice>}

      {catalog.data.products.length === 0 ? (
        <p>{c.empty}</p>
      ) : (
        <ul className="queue">
          {catalog.data.products.map((product) => (
            <li key={product.id} className="panel">
              <h2>
                {product.title}{" "}
                <span className="badge">{c.statuses[product.status]}</span>
              </h2>
              {product.description && <p>{product.description}</p>}
              <form action={changeCategoryAction} className="filters">
                {hidden}
                <input type="hidden" name="productId" value={product.id} />
                <CategorySelect
                  locale={locale}
                  categories={categories}
                  value={product.categoryId}
                />
                <button type="submit" className="link-button">
                  {t.categories.change}
                </button>
              </form>
              <div className="actions">
                {nextStatuses[product.status]
                  .filter((s) => s !== "PUBLISHED" || canPublish)
                  .map((status) => (
                    <form key={status} action={changeStatusAction}>
                      {hidden}
                      <input
                        type="hidden"
                        name="productId"
                        value={product.id}
                      />
                      <input type="hidden" name="status" value={status} />
                      <input
                        type="hidden"
                        name="expectedVersion"
                        value={product.version}
                      />
                      <button
                        type="submit"
                        className={status === "PUBLISHED" ? "cta" : "secondary"}
                      >
                        {statusLabel(status, product.status)}
                      </button>
                    </form>
                  ))}
              </div>
              {product.variants.map((variant) => (
                <section key={variant.id} className="variant">
                  <h3>
                    {variant.label} · <code>{variant.sku}</code> ·{" "}
                    {formatMoney(
                      BigInt(variant.price.amountMinor),
                      variant.price.currency,
                      locale,
                    )}
                  </h3>
                  <dl className="facts">
                    <dt>{c.available}</dt>
                    <dd>{variant.stock.available}</dd>
                    <dt>{c.onHand}</dt>
                    <dd>{variant.stock.onHand}</dd>
                    <dt>{c.reserved}</dt>
                    <dd>{variant.stock.reserved}</dd>
                  </dl>
                  <div className="inline-forms">
                    {(["receive", "adjust"] as const).map((mode) => (
                      <form
                        key={mode}
                        action={moveStockAction}
                        className="stack"
                      >
                        {hidden}
                        <input
                          type="hidden"
                          name="variantId"
                          value={variant.id}
                        />
                        <input type="hidden" name="mode" value={mode} />
                        {/* Clé fixée au rendu : renvoyer ce formulaire ne compte jamais deux fois. */}
                        <input
                          type="hidden"
                          name="idempotencyKey"
                          value={randomUUID().replaceAll("-", "")}
                        />
                        <label>
                          {mode === "receive" ? c.quantity : c.adjustment}
                          <input
                            name="quantity"
                            type="number"
                            inputMode="numeric"
                            step={1}
                            required
                            {...(mode === "receive"
                              ? { min: 1, max: 100000 }
                              : { min: -100000, max: 100000 })}
                          />
                        </label>
                        <button type="submit" className="secondary">
                          {mode === "receive" ? c.receive : c.adjust}
                        </button>
                      </form>
                    ))}
                    <form action={changePriceAction} className="stack">
                      {hidden}
                      <input
                        type="hidden"
                        name="variantId"
                        value={variant.id}
                      />
                      <input
                        type="hidden"
                        name="expectedVersion"
                        value={variant.version}
                      />
                      <label>
                        {c.newPrice}
                        <input
                          name="priceMinor"
                          inputMode="numeric"
                          pattern="[0-9]{1,15}"
                          required
                          defaultValue={variant.price.amountMinor}
                        />
                      </label>
                      <button type="submit" className="secondary">
                        {c.updatePrice}
                      </button>
                    </form>
                  </div>
                </section>
              ))}
              <section className="variant" aria-label={c.photos.title}>
                <h3>{c.photos.title}</h3>
                {product.media.length > 0 && (
                  <ul className="photo-list">
                    {product.media.map((m) => (
                      <li key={m.id}>
                        {m.altFr} — {c.photos.statuses[m.status]}
                      </li>
                    ))}
                  </ul>
                )}
                <PhotoUpload
                  storeId={storeId}
                  productId={product.id}
                  labels={c.photos}
                />
              </section>
            </li>
          ))}
        </ul>
      )}

      <section aria-labelledby="new-product" className="panel">
        <h2 id="new-product">{c.newProduct}</h2>
        <form action={createProductAction} className="stack">
          {hidden}
          <label>
            {c.productTitle}
            <input name="title" required minLength={2} maxLength={140} />
          </label>
          <label>
            {c.description}
            <textarea name="description" maxLength={2000} rows={3} />
          </label>
          <CategorySelect locale={locale} categories={categories} />
          <p className="hint">{c.variantsHelp}</p>
          {[0, 1, 2].map((i) => (
            <fieldset key={i} className="variant-row">
              <legend>
                {c.label} {i + 1}
              </legend>
              <label>
                {c.sku}
                <input
                  name={`sku_${i}`}
                  maxLength={64}
                  required={i === 0}
                  autoCapitalize="characters"
                />
              </label>
              <label>
                {c.label}
                <input name={`label_${i}`} maxLength={80} required={i === 0} />
              </label>
              <label>
                {c.price}
                <input
                  name={`price_${i}`}
                  inputMode="numeric"
                  pattern="[0-9]{1,15}"
                  required={i === 0}
                />
              </label>
            </fieldset>
          ))}
          <p className="hint">{c.photosLater}</p>
          <button type="submit" className="cta">
            {c.create}
          </button>
        </form>
      </section>
    </AccountShell>
  );
}
