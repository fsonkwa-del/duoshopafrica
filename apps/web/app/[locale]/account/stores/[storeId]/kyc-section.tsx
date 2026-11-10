import { type Locale, messages } from "@duoshop/i18n";
import type { KycDocumentType, StoreKycDTO } from "@duoshop/sdk";
import { Notice } from "@duoshop/ui";
import { submitKycAction, uploadKycAction } from "./actions";

// Dossier KYC de la boutique (lot 5) : pièces par niveau, puis dépôt du dossier.
export function KycSection({
  locale,
  storeId,
  data,
  outcome,
}: {
  locale: Locale;
  storeId: string;
  data: StoreKycDTO;
  outcome?: string;
}) {
  const k = messages[locale].kyc;
  const received = new Set(data.documents.map((d) => d.documentType));
  const errorCode = outcome?.startsWith("kyc_error_")
    ? outcome.slice("kyc_error_".length)
    : null;
  return (
    <section aria-labelledby="kyc" className="panel">
      <h2 id="kyc">{k.title}</h2>
      <p className="hint">{k.intro}</p>
      <p>
        <strong>{k.statuses[data.status]}</strong> · {k.approvedTier} :{" "}
        {data.approvedTier}
      </p>
      {data.reason && <p className="meta">{data.reason}</p>}
      {outcome === "kyc_uploaded" && <Notice>{k.uploaded}</Notice>}
      {outcome === "kyc_submitted" && <Notice>{k.submitted}</Notice>}
      {errorCode && (
        <Notice>
          {errorCode in k.errors
            ? k.errors[errorCode as keyof typeof k.errors]
            : k.errors.unknown}
        </Notice>
      )}
      {!data.enabled ? (
        <Notice>{k.unavailable}</Notice>
      ) : (
        <>
          {([1, 2, 3] as const).map((tier) => {
            const rows = data.requirements.filter((r) => r.tier === tier);
            return (
              <div key={tier}>
                <h3>{k.tiers[tier]}</h3>
                <ul>
                  {rows.map((r) => (
                    <li key={r.documentType}>
                      {k.types[r.documentType]}
                      {r.alternativeGroup ? ` (${k.or})` : ""} —{" "}
                      {received.has(r.documentType) ? k.received : k.missing}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <form action={uploadKycAction} className="stack">
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="storeId" value={storeId} />
            <label>
              {k.tier}
              <select name="type">
                {(Object.keys(k.types) as KycDocumentType[]).map((t) => (
                  <option key={t} value={t}>
                    {k.types[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {k.file}
              <input
                type="file"
                name="file"
                accept="image/jpeg,image/png,application/pdf"
                required
              />
            </label>
            <button type="submit" className="secondary">
              {k.upload}
            </button>
          </form>
          {data.status !== "SUBMITTED" && (
            <form action={submitKycAction} className="stack">
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="storeId" value={storeId} />
              <label>
                {k.tier}
                <select name="tier" defaultValue="1">
                  {([1, 2, 3] as const).map((tier) => (
                    <option key={tier} value={tier}>
                      {k.tiers[tier]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {k.mobileMoney}
                <input
                  name="mobileMoneyNumber"
                  type="tel"
                  maxLength={20}
                  required
                />
              </label>
              <label>
                {k.location}
                <input name="location" minLength={3} maxLength={200} required />
              </label>
              <label>
                {k.niu}
                <input name="niu" maxLength={40} />
              </label>
              <button type="submit" className="cta">
                {k.submit}
              </button>
            </form>
          )}
        </>
      )}
    </section>
  );
}
