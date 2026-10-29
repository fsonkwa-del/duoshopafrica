import { randomUUID } from "node:crypto";
import { formatMoney, isLocale, messages } from "@duoshop/i18n";
import { getOrder } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../../lib/session";
import { ShopShell } from "../../../shop-shell";
import { openClaimAction } from "../actions";

const reasons = [
  "DAMAGED",
  "WRONG_ITEM",
  "NOT_AS_DESCRIBED",
  "MISSING_ITEM",
  "OTHER",
] as const;

export default async function NewClaim({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; orderId: string }>;
  searchParams: Promise<{ seller?: string; error?: string }>;
}) {
  const { locale, orderId } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const t = messages[locale];
  const c = t.claims;
  const token = await sessionToken();
  const result = token ? await getOrder(apiUrl, token, orderId) : null;
  if (!token || !result?.ok) notFound();
  const seller = result.data.sellers.find((s) => s.id === query.seller);
  if (!seller) notFound();
  const orderPage = `/${locale}/orders/${orderId}`;
  return (
    <ShopShell locale={locale} path={`/orders/${orderId}/claim`}>
      <p>
        <Link href={orderPage}>
          {t.orders.number} {orderId.slice(0, 8).toUpperCase()}
        </Link>
      </p>
      <h1>{c.report}</h1>
      <p>
        {t.orders.seller} : {seller.storeName}
      </p>
      <p className="hint">{c.reportHelp}</p>
      {query.error && (
        <Notice>
          {query.error in c.errors
            ? c.errors[query.error as keyof typeof c.errors]
            : c.errors.unknown}
        </Notice>
      )}
      {!seller.claimable ? (
        <Notice>{c.errors.window_closed}</Notice>
      ) : (
        <form action={openClaimAction} className="stack">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="orderId" value={orderId} />
          <input type="hidden" name="sellerOrderId" value={seller.id} />
          {/* Clé fixée au rendu : un double envoi ne crée qu'une réclamation. */}
          <input
            type="hidden"
            name="idempotencyKey"
            value={randomUUID().replaceAll("-", "")}
          />
          <fieldset className="panel">
            <legend>{c.quantity}</legend>
            {seller.items.map((item) => (
              <label key={item.id}>
                {item.title} — {item.label} (×{item.quantity},{" "}
                {formatMoney(
                  BigInt(item.unitPrice.amountMinor),
                  item.unitPrice.currency,
                  locale,
                )}
                )
                <input
                  name={`q_${item.id}`}
                  type="number"
                  min={0}
                  max={item.quantity}
                  defaultValue={seller.items.length === 1 ? item.quantity : 0}
                />
              </label>
            ))}
          </fieldset>
          <label>
            {c.reason}
            <select name="reason" defaultValue="DAMAGED">
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {c.reasons[r]}
                </option>
              ))}
            </select>
          </label>
          <label>
            {c.description}
            <textarea
              name="description"
              minLength={10}
              maxLength={1000}
              rows={4}
              required
            />
          </label>
          <button type="submit" className="cta">
            {c.submit}
          </button>
        </form>
      )}
    </ShopShell>
  );
}
