# ADR 0008 — Socle de conformité : paramètres datés, migrations réversibles, flux sortants

Date : 2026-11-09. Statut : accepté le 2026-11-10 et livré (lot 0 du [plan de conformité](../compliance/PLAN.md)).

## Contexte

Les lots de conformité introduisent de nombreuses valeurs réglementaires : TVA, durées de conservation, délai de réclamation, plafonds KYC, réserve des nouveaux vendeurs, frais du prestataire. Ces valeurs changent par décision externe et doivent s'appliquer à la date de l'événement, pas à la date du calcul. Aujourd'hui, certaines sont des constantes : 7 jours de réclamation, 10 minutes de tentative, 30 minutes de réservation, 30 jours de purge des paniers. Prisma n'offre par ailleurs aucune migration de retour arrière.

## Décision

1. **Table `RegulatoryParameter`** : `key`, `scope` (plateforme, ou boutique pour un contrat vendeur), `value` en JSON typé par un schéma par clé, `effectiveFrom`, `effectiveTo`, `legalBasis` (texte libre), `validationStatus` (`A_VALIDER`, `VALIDE`), `createdBy`, `approvedBy`.
   - Ajout seul : une valeur n'est jamais modifiée, on en clôt une et on en ouvre une autre. Les périodes d'une même clé et d'un même périmètre ne se chevauchent pas (contrainte d'exclusion PostgreSQL).
   - Lecture par une fonction SQL `param_at(key, scope, at)` utilisable dans les fonctions métier, et par un module TypeScript typé.
   - Écriture réservée à FINANCE pour les paramètres financiers, à ADMIN pour les autres. Une valeur prend effet seulement après approbation par une seconde personne, avec MFA et audit.
   - La migration sème les valeurs actuelles, toutes en `A_VALIDER`. L'interface d'administration affiche ce statut.
   - Les constantes actuelles sont remplacées par des lectures de paramètres, sans changer leur valeur.
2. **Migrations réversibles** : un `down.sql` à côté de chaque nouveau `migration.sql`, un script `pnpm db:down <migration>`, et un job CI qui fait montée → descente → montée sur une base neuve et compare le schéma obtenu. Une descente qui supprimerait des données saisies refuse de s'exécuter si la table n'est pas vide.
3. **Garde des flux sortants** : un script CI extrait tous les noms d'hôtes externes de la configuration (`deploy/`, variables d'environnement d'exemple, adaptateurs, CSP). Il échoue si l'un d'eux n'est pas déclaré dans `docs/compliance/flux-sortants.md`. Les domaines réservés aux tests (`*.example`, `*.invalid`, `localhost`) sont ignorés.
4. **Fichiers de conformité** : `hypotheses.md`, `questions.md`, `flux-sortants.md`, `registre.md` sous `docs/compliance/`.

## Conséquences

- Changer un taux ou une durée ne demande plus de déploiement, mais une saisie à deux personnes.
- Toute fonction qui dépend d'une date (TVA, réclamation, conservation) devient testable à n'importe quelle date.
- Les migrations antérieures au lot 0 restent sans `down.sql` ; seules les nouvelles en ont un.

## Mise en œuvre (10 novembre 2026)

- Migration `202611170001_regulatory_parameters` et son `down.sql`. Les tables `ParameterDefinition` (type, bornes, rôle propriétaire) et `RegulatoryParameter` sont en ajout seul pour le runtime. Une contrainte d'exclusion (`btree_gist`) empêche deux périodes approuvées de se chevaucher.
- Fonctions `param_value` et `param_interval` (lecture à une date), `propose_parameter` et `decide_parameter` (seconde personne obligatoire, audit dans `ConfigAudit`).
- Quatre constantes remplacées, valeurs inchangées et marquées « à valider » :
  - `order.payment_window` (30 minutes) ;
  - `payment.attempt_window` (10 minutes, dans `start_payment` et `close_unpaid_order`) ;
  - `claims.window` (7 jours, lu à la date de remise dans `open_claim` et pour l'affichage) ;
  - `guest_cart.retention` (30 jours).
- Approbation : le rôle propriétaire de la clé propose, puis un autre membre ADMIN ou FINANCE approuve. Ces quatre clés appartiennent à ADMIN.
- Écran d'administration « Paramètres réglementaires » en français et en anglais, avec les routes `/v1/admin/parameters`.
- `pnpm db:down <migration>` et `pnpm db:roundtrip`, exécuté en CI. `pnpm check:outbound`, exécuté en CI.

