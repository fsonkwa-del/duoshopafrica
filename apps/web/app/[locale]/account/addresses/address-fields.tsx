import { type Locale, messages } from "@duoshop/i18n";
import type { DeliveryZoneDTO } from "@duoshop/types";

// Champs d'adresse locale (quartier et repère obligatoires), partagés entre
// « Mes adresses » et le checkout. Le numéro est normalisé par l'API. Le quartier choisi dans la
// liste fixe le tarif de livraison de chaque boutique (ADR 0015).
export function AddressFields({
  locale,
  zones,
}: {
  locale: Locale;
  zones: DeliveryZoneDTO[];
}) {
  const a = messages[locale].addresses;
  const field = (
    name: string,
    label: string,
    props: Record<string, unknown> = {},
  ) => (
    <label>
      {label}
      <input name={name} {...props} />
    </label>
  );
  return (
    <>
      {field("label", a.label, {
        required: true,
        maxLength: 40,
        defaultValue: locale === "fr" ? "Maison" : "Home",
      })}
      {field("recipientName", a.recipientName, {
        required: true,
        minLength: 2,
        maxLength: 80,
        autoComplete: "name",
      })}
      {field("phone", a.phone, {
        required: true,
        type: "tel",
        inputMode: "tel",
        autoComplete: "tel",
        maxLength: 20,
      })}
      {field("city", a.city, {
        required: true,
        defaultValue: "Douala",
        maxLength: 60,
      })}
      <label>
        {a.zone}
        <select name="zoneId" defaultValue="">
          <option value="">{a.zoneOther}</option>
          {zones.map((z) => (
            <option key={z.id} value={z.id}>
              {z.name}
            </option>
          ))}
        </select>
      </label>
      {field("district", a.district, { maxLength: 80 })}
      {field("landmark", a.landmark, {
        required: true,
        minLength: 3,
        maxLength: 160,
      })}
      {field("details", a.details, { maxLength: 200 })}
    </>
  );
}
