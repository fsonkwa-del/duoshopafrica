-- Données de référence indispensables hors développement : le seed est interdit en production,
-- or les variantes exigent la devise (clé étrangère). Aucune boutique de démonstration ici.
INSERT INTO "Currency" ("code", "minorUnits") VALUES ('XAF', 0) ON CONFLICT DO NOTHING;
INSERT INTO "Country" ("code", "name", "enabled") VALUES ('CM', 'Cameroun', false) ON CONFLICT DO NOTHING;
INSERT INTO "Locale" ("code") VALUES ('fr'), ('en') ON CONFLICT DO NOTHING;
