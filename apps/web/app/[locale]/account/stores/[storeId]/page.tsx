import { isLocale, messages } from "@duoshop/i18n";
import { getStore } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import Link from "next/link";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../../lib/session";
import { SellerNav } from "../../../admin/admin-nav";
import { AccountShell, SignIn } from "../../account-shell";
import { saveFulfilment, sendVerification } from "./actions";

export default async function StorePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; storeId: string }>;
  searchParams: Promise<{ verification?: string }>;
}) {
  const { locale, storeId } = await params;
  const { verification: outcome } = await searchParams;
  if (!isLocale(locale)) notFound();
  const t = messages[locale];
  const path = `/account/stores/${storeId}`;
  const token = await sessionToken();
  const result = token ? await getStore(apiUrl, token, storeId) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  const back = <Link href={`/${locale}/account`}>{t.backToStores}</Link>;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <p>{back}</p>
        <Notice>
          {result.status === 403 ? t.storeUnavailable : t.storeNotFound}
        </Notice>
      </AccountShell>
    );
  const store = result.data;
  const v = t.verification;
  const status = store.verification.status;
  // L'API reste juge ; l'interface n'offre le formulaire qu'au propriétaire d'une demande ouverte.
  const canSubmit =
    store.role === "OWNER" && (status === "PENDING" || status === "REJECTED");
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <SellerNav locale={locale} storeId={storeId} current={path} />
      <p>{back}</p>
      <h1>{store.name}</h1>
      {outcome === "opened" && <Notice>{t.openStore.next}</Notice>}
      {store.isDemo && <Notice>{t.demoStore}</Notice>}
      <dl className="facts">
        <dt>{t.yourRole}</dt>
        <dd>{t.roles[store.role]}</dd>
        <dt>{t.storeStatus}</dt>
        <dd>{t.tenantStatuses[store.tenantStatus]}</dd>
        <dt>{t.storeHandle}</dt>
        <dd>{store.slug}</dd>
      </dl>
      <p>
        <Link
          className="cta"
          href={`/${locale}/account/stores/${store.id}/catalog`}
        >
          {t.catalog.open}
        </Link>{" "}
        <Link href={`/${locale}/account/stores/${store.id}/orders`}>
          {t.fulfilment.ordersLink}
        </Link>{" "}
        <Link href={`/${locale}/account/stores/${store.id}/earnings`}>
          {t.earnings.link}
        </Link>{" "}
        <Link href={`/${locale}/account/stores/${store.id}/claims`}>
          {t.claims.title}
        </Link>
      </p>
      <section aria-labelledby="fulfilment" className="panel">
        <h2 id="fulfilment">{t.fulfilment.title}</h2>
        {outcome === "fulfilment_saved" && (
          <Notice>{t.fulfilment.saved}</Notice>
        )}
        {outcome === "fulfilment_failed" && (
          <Notice>{t.fulfilment.failed}</Notice>
        )}
        <form action={saveFulfilment} className="stack">
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="storeId" value={store.id} />
          <input
            type="hidden"
            name="expectedVersion"
            value={store.fulfilment.version}
          />
          <label>
            {t.fulfilment.deliveryFee}
            <input
              name="deliveryFeeMinor"
              inputMode="numeric"
              pattern="[0-9]{0,9}"
              defaultValue={store.fulfilment.deliveryFeeMinor ?? ""}
            />
          </label>
          <label className="variant-choice">
            <input
              type="checkbox"
              name="pickupEnabled"
              defaultChecked={store.fulfilment.pickupEnabled}
            />
            <span>{t.fulfilment.pickupEnabled}</span>
          </label>
          <label>
            {t.fulfilment.pickupInstructions}
            <input
              name="pickupInstructions"
              maxLength={300}
              defaultValue={store.fulfilment.pickupInstructions ?? ""}
            />
          </label>
          <button type="submit" className="secondary">
            {t.fulfilment.save}
          </button>
        </form>
      </section>
      <section aria-labelledby="verification" className="panel">
        <h2 id="verification">{v.title}</h2>
        {outcome === "submitted" && <Notice>{v.submitted}</Notice>}
        {outcome === "failed" && <Notice>{v.failed}</Notice>}
        {outcome === "invalid_phone" && <Notice>{v.invalidPhone}</Notice>}
        <p>
          <strong>{v.statuses[status]}</strong>
        </p>
        {store.verification.reason && (
          <p>
            {v.reason} : {store.verification.reason}
          </p>
        )}
        {canSubmit && (
          <form action={sendVerification} className="stack">
            <p>{v.intro}</p>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="storeId" value={store.id} />
            <fieldset className="stack">
              <legend>{v.owner}</legend>
              <label>
                {v.ownerName}
                <input
                  name="ownerName"
                  required
                  minLength={2}
                  maxLength={120}
                  autoComplete="name"
                />
              </label>
              <label>
                {v.ownerPhone}
                <input
                  name="ownerPhone"
                  type="tel"
                  required
                  minLength={9}
                  maxLength={20}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="6XX XX XX XX"
                />
              </label>
              <label>
                {v.city}
                <input
                  name="city"
                  required
                  minLength={2}
                  maxLength={80}
                  defaultValue="Douala"
                  autoComplete="address-level2"
                />
              </label>
              <label>
                {v.district}
                <input name="district" required minLength={2} maxLength={80} />
              </label>
            </fieldset>
            <label>
              {v.businessType}
              <select name="businessType" required defaultValue="">
                <option value="" disabled>
                  {v.choose}
                </option>
                {(["INDIVIDUAL", "SOLE_PROPRIETOR", "COMPANY"] as const).map(
                  (type) => (
                    <option key={type} value={type}>
                      {v.businessTypes[type]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              {v.legalName}
              <input
                name="legalName"
                required
                minLength={2}
                maxLength={160}
                autoComplete="organization"
              />
            </label>
            <label>
              {v.registrationNumber}
              <input
                name="registrationNumber"
                maxLength={64}
                pattern="[A-Za-z0-9 ./\-]*"
              />
            </label>
            <p className="hint">{v.documentsLater}</p>
            <button type="submit" className="cta">
              {v.submit}
            </button>
          </form>
        )}
      </section>
    </AccountShell>
  );
}
