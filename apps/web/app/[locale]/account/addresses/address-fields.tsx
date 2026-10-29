import { type Locale, messages } from "@duoshop/i18n";

// Champs d'adresse locale (quartier et repère obligatoires), partagés entre
// « Mes adresses » et le checkout. Le numéro est normalisé par l'API.
export function AddressFields({ locale }: { locale: Locale }) {
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
      {field("district", a.district, { required: true, maxLength: 80 })}
      {field("landmark", a.landmark, {
        required: true,
        minLength: 3,
        maxLength: 160,
      })}
      {field("details", a.details, { maxLength: 200 })}
    </>
  );
}
