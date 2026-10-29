export const brand = {
  name: "DuoShopAfrica",
  provisional: true,
  logo: null,
  domain: null,
  supportEmail: null,
  colors: {
    // Inspirée de Pinduoduo (rouge vif, fonds gris clair), foncée pour le contraste AA.
    primary: "#D7261C",
    accent: "#C2410C",
    background: "#F5F5F5",
    ink: "#151516",
  },
  metadata: {
    fr: "Le commerce de proximité, ouvert sur le monde.",
    en: "Local commerce, open to the world.",
  },
} as const;
export const businessDefaults = {
  country: "CM",
  currency: "XAF",
  timezone: "Africa/Douala",
  locales: ["fr", "en"],
} as const;
// Tarifs commerciaux volontairement absents : simulations documentées, jamais actives par défaut.
