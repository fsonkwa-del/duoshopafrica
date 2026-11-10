# ADR 0008 — Socle de conformité : paramètres datés, migrations réversibles, flux sortants

Date : 2026-11-09. Statut : proposé (lot 0 du [plan de conformité](../compliance/PLAN.md)).

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
