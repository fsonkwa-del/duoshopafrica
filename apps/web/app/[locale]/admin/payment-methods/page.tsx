import { isLocale, type Locale, messages } from "@duoshop/i18n";
import { getAdminPaymentMethods } from "@duoshop/sdk";
import type { AdminPaymentMethodDTO } from "@duoshop/types";
import { Notice } from "@duoshop/ui";
import { notFound } from "next/navigation";
import { apiUrl, sessionToken } from "../../../../lib/session";
import { staffError } from "../../../../lib/staff";
import { AccountShell, SignIn } from "../../account/account-shell";
import { AdminNav } from "../admin-nav";
import { saveMethod } from "./actions";

const kinds = ["MOBILE_MONEY", "CARD", "BANK_TRANSFER", "WALLET"] as const;

function MethodFields({
  locale,
  method,
}: {
  locale: Locale;
  method?: AdminPaymentMethodDTO;
}) {
  const m = messages[locale].admin.methods;
  return (
    <>
      <label>
        {m.kind}
        <select name="kind" defaultValue={method?.kind ?? "MOBILE_MONEY"}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {m.kinds[k]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {m.operator}
        <input
          name="operator"
          defaultValue={method?.operator ?? ""}
          maxLength={30}
        />
      </label>
      <label>
        {m.provider}
        <input
          name="provider"
          defaultValue={method?.provider ?? ""}
          required
          maxLength={40}
        />
      </label>
      <label>
        {m.country}
        <input
          name="countryCode"
          defaultValue={method?.countryCode ?? "CM"}
          required
          maxLength={2}
        />
      </label>
      <label>
        {m.currency}
        <input
          name="currency"
          defaultValue={method?.currency ?? "XAF"}
          required
          maxLength={3}
        />
      </label>
      <label>
        {m.labelFr}
        <input
          name="labelFr"
          defaultValue={method?.labelFr ?? ""}
          required
          maxLength={80}
        />
      </label>
      <label>
        {m.labelEn}
        <input
          name="labelEn"
          defaultValue={method?.labelEn ?? ""}
          required
          maxLength={80}
        />
      </label>
      <label>
        {m.instructionsFr}
        <input
          name="instructionsFr"
          defaultValue={method?.instructionsFr ?? ""}
          maxLength={300}
        />
      </label>
      <label>
        {m.instructionsEn}
        <input
          name="instructionsEn"
          defaultValue={method?.instructionsEn ?? ""}
          maxLength={300}
        />
      </label>
      <label>
        {m.prefixes}
        <input
          name="phonePrefixes"
          defaultValue={method?.phonePrefixes.join(",") ?? ""}
        />
      </label>
      <label>
        {m.min}
        <input
          name="minAmountMinor"
          inputMode="numeric"
          defaultValue={method?.minAmountMinor ?? "100"}
          required
        />
      </label>
      <label>
        {m.max}
        <input
          name="maxAmountMinor"
          inputMode="numeric"
          defaultValue={method?.maxAmountMinor ?? ""}
        />
      </label>
      <label>
        {m.order}
        <input
          name="displayOrder"
          type="number"
          min={0}
          max={10000}
          defaultValue={method?.displayOrder ?? 100}
        />
      </label>
      <label className="variant-choice">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={method?.enabled ?? false}
        />
        <span>{m.enabled}</span>
      </label>
    </>
  );
}

export default async function PaymentMethods({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ result?: string; error?: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const query = await searchParams;
  const a = messages[locale].admin;
  const m = a.methods;
  const path = "/admin/payment-methods";
  const token = await sessionToken();
  const result = token ? await getAdminPaymentMethods(apiUrl, token) : null;
  if (!result || (!result.ok && result.status === 401))
    return <SignIn locale={locale} path={path} />;
  if (!result.ok)
    return (
      <AccountShell locale={locale} path={path} signedIn>
        <h1>{m.title}</h1>
        <Notice>
          {result.status === 404
            ? a.notStaff
            : staffError(locale, result.error)}
        </Notice>
      </AccountShell>
    );
  const { methods, providers } = result.data;
  return (
    <AccountShell locale={locale} path={path} signedIn>
      <AdminNav locale={locale} />
      <h1>{m.title}</h1>
      <p>{m.intro}</p>
      {query.result === "saved" && <Notice>{m.saved}</Notice>}
      {query.error && <Notice>{staffError(locale, query.error)}</Notice>}
      <p>
        <strong>{m.available} :</strong>{" "}
        {providers.length === 0
          ? m.noneAvailable
          : providers.map((p) => `${p.key} (${m.modes[p.mode]})`).join(", ")}
      </p>
      {methods.length === 0 ? (
        <p>{m.empty}</p>
      ) : (
        <ul className="queue">
          {methods.map((method) => (
            <li key={method.id} className="panel">
              <h2>
                {method.code} ·{" "}
                <span className="badge">
                  {method.providerMode
                    ? m.modes[method.providerMode]
                    : m.providerMissing}
                </span>
              </h2>
              <form action={saveMethod} className="stack">
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="methodId" value={method.id} />
                <input
                  type="hidden"
                  name="expectedVersion"
                  value={method.version}
                />
                <MethodFields locale={locale} method={method} />
                <button type="submit" className="cta">
                  {m.save}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      <section className="panel" aria-labelledby="add-method">
        <h2 id="add-method">{m.add}</h2>
        <form action={saveMethod} className="stack">
          <input type="hidden" name="locale" value={locale} />
          <label>
            {m.code}
            <input
              name="code"
              required
              maxLength={40}
              pattern="[A-Za-z0-9_]{2,40}"
            />
          </label>
          <MethodFields locale={locale} />
          <button type="submit" className="cta">
            {m.add}
          </button>
        </form>
      </section>
    </AccountShell>
  );
}
