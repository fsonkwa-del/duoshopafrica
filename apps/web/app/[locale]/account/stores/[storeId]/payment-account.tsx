import { type Locale, messages } from "@duoshop/i18n";
import type { PaymentAccountsDTO } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { savePaymentAccountAction } from "./actions";

const fieldsByProvider: Record<string, readonly string[]> = {
  fapshi: ["apiUser", "apiKey", "webhookSecret"],
  mock: ["secret"],
};

// Compte marchand du vendeur (mode direct, lot 3) : identifiants saisis, jamais réaffichés.
export function PaymentAccount({
  locale,
  storeId,
  data,
  outcome,
  notifyUrl,
}: {
  locale: Locale;
  storeId: string;
  data: PaymentAccountsDTO;
  outcome?: string;
  notifyUrl?: string;
}) {
  const c = messages[locale].collection;
  const direct = data.collectionMode === "DIRECT_SELLER";
  return (
    <section aria-labelledby="payment-account" className="panel">
      <h2 id="payment-account">{c.sellerTitle}</h2>
      <p className="hint">{direct ? c.sellerDirect : c.sellerPlatform}</p>
      {outcome === "account_saved" && (
        <Notice>
          {c.saved} <code>{notifyUrl}</code>
        </Notice>
      )}
      {outcome === "account_failed" && <Notice>{c.failed}</Notice>}
      {data.accounts.length > 0 && (
        <ul>
          {data.accounts.map((a) => (
            <li key={a.id}>
              {c.configured} : {a.provider} · {c.modes[a.mode]} ·{" "}
              {a.active ? c.active : c.inactive}
            </li>
          ))}
        </ul>
      )}
      {direct &&
        data.providers.map((provider) => (
          <form
            key={provider}
            action={savePaymentAccountAction}
            className="stack"
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="storeId" value={storeId} />
            <input type="hidden" name="provider" value={provider} />
            <p>
              <strong>
                {c.provider} : {provider}
              </strong>
            </p>
            <label>
              {c.mode}
              <select
                name="mode"
                defaultValue={provider === "mock" ? "MOCK" : "SANDBOX"}
              >
                {(provider === "mock"
                  ? (["MOCK"] as const)
                  : (["SANDBOX", "LIVE"] as const)
                ).map((m) => (
                  <option key={m} value={m}>
                    {c.modes[m]}
                  </option>
                ))}
              </select>
            </label>
            {(fieldsByProvider[provider] ?? []).map((field) => (
              <label key={field}>
                {c.fields[field as keyof typeof c.fields] ?? field}
                <input
                  name={`cred_${field}`}
                  type="password"
                  autoComplete="off"
                  minLength={4}
                  maxLength={500}
                  required
                />
              </label>
            ))}
            <button type="submit" className="secondary">
              {c.save}
            </button>
          </form>
        ))}
    </section>
  );
}
