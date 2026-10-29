import {
  formatDateTime,
  formatMoney,
  type Locale,
  messages,
} from "@duoshop/i18n";
import type { ClaimDTO, MoneyDTO } from "@duoshop/types";
import type { ReactNode } from "react";

// Réclamation : statut, articles, montant, historique et remboursement (acheteur, vendeur, admin).
export function ClaimCard({
  locale,
  claim,
  children,
}: {
  locale: Locale;
  claim: ClaimDTO;
  children?: ReactNode;
}) {
  const c = messages[locale].claims;
  const money = (m: MoneyDTO) =>
    formatMoney(BigInt(m.amountMinor), m.currency, locale);
  return (
    <article className="panel" id={`c-${claim.id}`}>
      <h3>
        {c.reasons[claim.reason]} ·{" "}
        <span className="badge">{c.statuses[claim.status]}</span>
      </h3>
      {claim.storeName && <p className="meta">{claim.storeName}</p>}
      <p>{claim.description}</p>
      <ul className="cart-lines">
        {claim.items.map((i) => (
          <li key={`${i.title}-${i.label}`}>
            <span>
              {i.title} — {i.label} × {i.quantity}
            </span>
            <strong>{money(i.amount)}</strong>
          </li>
        ))}
      </ul>
      <p>
        {c.amount} : <strong>{money(claim.amount)}</strong>
      </p>
      {claim.refund && (
        <p className="notice">
          {c.refund} : {money(claim.refund.amount)}
          {claim.refund.status === "PENDING_PROVIDER"
            ? ` — ${c.refundPending}`
            : ""}
        </p>
      )}
      <ol className="timeline" aria-label={c.title}>
        {claim.events.map((e) => (
          <li key={`${e.status}-${e.createdAt}`}>
            <time dateTime={e.createdAt}>
              {formatDateTime(e.createdAt, locale)}
            </time>{" "}
            — {c.actors[e.actor as keyof typeof c.actors] ?? e.actor} :{" "}
            {c.statuses[e.status]}
            {e.note ? ` (${e.note})` : ""}
          </li>
        ))}
      </ol>
      {children}
    </article>
  );
}
