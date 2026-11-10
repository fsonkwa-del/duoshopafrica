import { type Locale, messages } from "@duoshop/i18n";
import type { SellerLegalDTO } from "@duoshop/types";

// Mentions légales du vendeur (loi n° 2010/021 ; liste exacte À VALIDER PAR JURISTE, H21).
// Fiche produit : mentions en vigueur ; commande : mentions figées à l'achat.
export function SellerLegal({
  locale,
  legal,
}: {
  locale: Locale;
  legal: SellerLegalDTO | null;
}) {
  const t = messages[locale];
  const l = t.legal;
  if (!legal) return <p className="meta">{l.unavailable}</p>;
  const location = [legal.district, legal.city].filter(Boolean).join(", ");
  const contact = [legal.contactPhone, legal.contactEmail]
    .filter(Boolean)
    .join(" · ");
  return (
    <dl className="legal-mentions">
      {legal.legalName && (
        <>
          <dt>{l.legalName}</dt>
          <dd>{legal.legalName}</dd>
        </>
      )}
      {legal.businessType && (
        <>
          <dt>{l.businessType}</dt>
          <dd>{t.verification.businessTypes[legal.businessType]}</dd>
        </>
      )}
      {legal.registrationNumber && (
        <>
          <dt>{l.registrationNumber}</dt>
          <dd>{legal.registrationNumber}</dd>
        </>
      )}
      {location && (
        <>
          <dt>{l.location}</dt>
          <dd>{location}</dd>
        </>
      )}
      {contact && (
        <>
          <dt>{l.contact}</dt>
          <dd>{contact}</dd>
        </>
      )}
    </dl>
  );
}
