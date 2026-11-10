# Plan de mise en conformité Cameroun / CEMAC

Date : 9 novembre 2026. Statut : **proposé, en attente de validation**. Aucun code n'est écrit avant validation.

Ce plan réduit nos contraintes réglementaires sans casser les garanties existantes : RLS, idempotence, journal en partie double, relecture du statut chez le prestataire et tests sur base réelle. Il ne rend la plateforme « conforme » à aucune loi. Chaque hypothèse juridique, fiscale ou comptable est listée dans [hypotheses.md](hypotheses.md), et chaque question ouverte dans [questions.md](questions.md).

## Règles communes à tous les lots

- **Une branche par lot**, issue de la branche principale à jour : `compliance/lot-N-<sujet>`. Le lot est fusionné seulement avec une CI verte sur son dernier commit.
- **Migrations réversibles.** Prisma ne gère pas les retours arrière. Chaque migration aura donc un `down.sql` à côté de `migration.sql`, et la CI vérifiera l'enchaînement montée → descente → montée sur une base neuve (ADR 0008). Une descente qui détruirait des données saisies refuse de s'exécuter si la table n'est pas vide : elle n'efface jamais en silence.
- **Valeurs réglementaires en base, datées.** Taux, délais, plafonds et durées vivent dans une table `RegulatoryParameter` à dates d'effet. Le code lit la valeur en vigueur à la date de l'événement, jamais une constante (ADR 0008).
- **Tests à chaque lot.** Tests unitaires plus tests sur base réelle, RLS active, avec les mêmes exigences qu'aujourd'hui : concurrence, rejeu, falsification, isolation.
- **Documentation à chaque lot.** Un ADR, la mise à jour de `docs/compliance/`, de `VALIDATION.md`, et les questions ajoutées à `questions.md`.

## Les lots

| Lot                       | ADR                                              | Contenu                                                                                                           | Dépend de                      | Taille estimée |
| ------------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------- |
| 0. Socle                  | [0008](../ADR/0008-regulatory-foundations.md)    | Paramètres réglementaires datés, migrations réversibles, garde CI des domaines externes, fichiers de conformité   | rien                           | 1 sprint       |
| 7. Adaptations juridiques | [0015](../ADR/0015-legal-product-adaptations.md) | Médiation au lieu d'arbitrage, mentions légales, délai de réclamation paramétré, frais par zone                   | 0                              | 1 sprint       |
| 2. Droits et consentement | [0010](../ADR/0010-data-subject-rights.md)       | Consentements versionnés, « Mes données », conservation, journal de consultation                                  | 0                              | 2 sprints      |
| 3. Mode d'encaissement    | [0011](../ADR/0011-collection-modes.md)          | Mode direct vendeur, capacités des prestataires, verrou du mode détenteur, push USSD, succès tardif               | 0, décision Fapshi             | 2 sprints      |
| 4. Comptabilité et TVA    | [0012](../ADR/0012-syscohada-tax.md)             | Correspondance SYSCOHADA, frais prestataire, TVA, factures de commission, exports                                 | 0, 3                           | 2 sprints      |
| 5. KYC par niveaux        | [0013](../ADR/0013-tiered-kyc.md)                | Pièces chiffrées, plafonds de ventes, double validation                                                           | 0, 2                           | 2 sprints      |
| 1. Localisation           | [0009](../ADR/0009-data-localisation.md)         | Hébergement au Cameroun, base séparée, sauvegardes PITR sur un second site, faible débit, flux sortants, registre | 0, choix hébergeur             | 2 à 3 sprints  |
| 8. Exploitation           | [0016](../ADR/0016-operations.md)                | Supervision, Redis, ClamAV, exposition réseau, SMS, WhatsApp, e-mail                                              | 1                              | 2 sprints      |
| 6. Reversements           | [0014](../ADR/0014-payouts.md)                   | Lots hebdomadaires sous double contrôle                                                                           | 3 avec prestataire agréé, 4, 5 | 2 sprints      |

## Ordre d'exécution recommandé

Deux voies avancent en parallèle : le **produit** (code applicatif) et l'**infrastructure** (hébergement et exploitation). Elles touchent des fichiers différents et ne se bloquent pas.

**Voie produit**

1. **Lot 0** : tous les autres en dépendent.
2. **Lot 7** : petit et peu risqué. Il fournit au juriste un produit concret à relire pendant que le reste avance.
3. **Lot 2** : aucun utilisateur réel ne doit s'inscrire sans consentement enregistré.
4. **Lots 3 et 4 ensemble** : en mode direct, la plateforme ne détient plus le dû au vendeur, mais une créance de commission sur lui. Le registre (lot 3) et la facturation de cette créance (lot 4) ne sont cohérents qu'ensemble.
5. **Lot 5** : en mode direct, le vendeur encaisse lui-même. Son identité doit donc être établie avant sa première vente réelle.
6. **Lot 6** : seulement après le choix d'un prestataire agréé capable de séquestre.

**Voie infrastructure**

1. **Lot 1, partie sans hébergeur** dès le lot 0 : inventaire des flux sortants, registre des traitements, optimisation faible débit, profils de déploiement génériques.
2. **Lot 1, partie hébergeur** dès que l'hébergeur camerounais est choisi et le budget approuvé : migration, base séparée, sauvegardes sur second site.
3. **Lot 8**, sur la nouvelle infrastructure.

**Pilote avec argent réel possible** après les lots 0, 7, 2, 3, 4, 5, 1 et 8, plus les validations externes. Le lot 6 n'est pas nécessaire en mode direct vendeur.

## Décisions que j'attends de toi avant d'écrire du code

1. **Valider ce plan et l'ordre.**
2. **Mode direct vendeur** : en mode direct, chaque vendeur doit avoir son propre compte marchand Fapshi, et la plateforme initie les paiements avec ses clés. Il faut l'accord de Fapshi, car ce montage peut encore ressembler à de l'agrégation (questions.md, P1 à P3). Confirmes-tu ce montage pour le pilote ?
3. **Hébergeur au Cameroun et budget** : il s'agit de ressources payantes, donc je ne crée rien sans ton accord. Je préparerai des profils génériques (Compose + Ansible) utilisables chez n'importe quel hébergeur offrant des machines virtuelles Linux. Je ne connais ni les offres ni les tarifs de Cloudstore Africa ou de CAMTEL : ils sont à demander.
4. **Trois conflits** entre ta demande et l'objectif « aucune donnée personnelle hors du Cameroun » (détail dans les ADR 0009 et 0016) :
   - **WhatsApp Business** passe par les serveurs de Meta, hors du Cameroun : le numéro du destinataire et le contenu du message sortent forcément. Faut-il le garder avec consentement explicite, ou s'en passer ?
   - **CDN** : même sans donnée personnelle dans le contenu, un CDN reçoit l'adresse IP de chaque visiteur, et une adresse IP est souvent considérée comme une donnée personnelle. Faut-il un CDN étranger ou une cache locale au Cameroun ?
   - **E-mail transactionnel** : un fournisseur étranger reçoit les adresses des destinataires. Un serveur de messagerie auto-hébergé au Cameroun est possible, mais sa délivrabilité est difficile.
5. **Selfie du lot 5** : un selfie comparé à une pièce d'identité relève de la donnée biométrique, ce qui alourdit les obligations. Je propose une vérification humaine sans traitement biométrique automatisé (ADR 0013). D'accord ?
6. **Qui supporte les frais Fapshi** par défaut : la plateforme ou le vendeur ?

## Risques de régression et parades

| Risque                                                                                                                                | Lot  | Parade                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Le passage au mode direct casse le journal : le compte « dû au vendeur » ne doit plus bouger, mais une créance de commission apparaît | 3, 4 | Écritures distinctes par mode, mode figé sur chaque paiement, contrainte d'équilibre inchangée ; les tests actuels du mode plateforme restent verts          |
| Les commandes déjà payées changent de sens comptable                                                                                  | 3, 4 | Le mode est mémorisé par paiement ; aucune réécriture rétroactive ; une migration de reprise uniquement si nécessaire                                        |
| La confirmation automatique d'un succès tardif provoque une survente                                                                  | 3    | Réservation du stock par la même mise à jour conditionnelle qu'aujourd'hui, dans la transaction `apply_payment_event` ; test de concurrence dédié            |
| Un paramètre daté manquant bloque une opération                                                                                       | 0    | Valeurs initiales semées par la migration, contrôle au démarrage de l'API et du worker, test qui vérifie la présence de chaque paramètre utilisé             |
| Le renommage « arbitrage » vers « médiation » casse les routes, les permissions ou les enregistrements d'audit                        | 7    | Nouveaux noms d'API, anciens noms gardés en alias pendant un lot ; anciennes actions d'audit lisibles ; tests E2E du litige                                  |
| Les frais par zone changent le total des commandes en cours                                                                           | 7    | Frais figés sur la commande (déjà le cas), zones appliquées aux seules nouvelles commandes                                                                   |
| Les plafonds KYC bloquent des ventes à tort, ou ne sont pas appliqués en concurrence                                                  | 5    | Contrôle dans la fonction SQL de paiement avec verrou sur le compteur mensuel ; tests de dépassement en parallèle                                            |
| La purge de conservation efface des données comptables ou un litige en cours                                                          | 2    | Purge par anonymisation, jamais sur une table comptable ; exclusion des dossiers en litige ou sous gel ; exécution à blanc journalisée avant la purge réelle |
| Le chiffrement des pièces KYC rend des pièces illisibles après une rotation de clé                                                    | 5    | Chiffrement par enveloppe avec version de clé par pièce ; test de rotation                                                                                   |
| La migration vers l'hébergeur camerounais perd des données ou casse Zitadel                                                           | 1    | Répétition complète sur l'environnement de pré-production, restauration testée, coupure planifiée ; Zitadel migré avec sa base, domaine inchangé             |
| Le faible débit dégrade la sécurité (cache de pages personnelles)                                                                     | 1    | Cache public réservé aux réponses sans cookie ; en-têtes `Cache-Control: private, no-store` vérifiés par test sur toutes les pages de compte                 |
| Redis indisponible bloque les connexions                                                                                              | 8    | Comportement explicite et testé : les limites refusent par défaut sur les routes sensibles et laissent passer ailleurs                                       |
| ClamAV ralentit ou bloque le traitement des photos                                                                                    | 8    | Analyse dans le worker, photo en attente tant qu'elle n'est pas analysée, alerte si la file grossit                                                          |
| Les migrations `down` divergent des `up`                                                                                              | tous | Test CI montée → descente → montée, et comparaison du schéma final avec celui d'une montée simple                                                            |

## Ce que ce plan ne fait pas

- Il ne choisit pas de prestataire agréé pour le séquestre, ne signe aucun contrat et ne crée aucune ressource payante.
- Il ne rédige ni CGU, ni CGV, ni politique de confidentialité : le produit affichera les textes fournis par le juriste, versionnés.
- Il ne remplace ni l'avis d'un juriste, ni celui d'un expert-comptable, ni la déclaration éventuelle auprès de l'autorité de protection des données.

## Avancement (10 novembre 2026)

| Lot                                  | Branche                        | État                                                                       |
| ------------------------------------ | ------------------------------ | -------------------------------------------------------------------------- |
| 0. Socle                             | `compliance/lot-0-foundations` | Livré, CI verte                                                            |
| 7. Adaptations juridiques            | `compliance/lot-7-legal`       | Livré, CI verte                                                            |
| 2. Droits et consentement            | `compliance/lot-2-privacy`     | Livré, CI verte                                                            |
| 3. Mode d'encaissement               | `compliance/lot-3-collection`  | Livré ; un échec E2E intermittent en CI, corrigé au lot 5                  |
| 4. Comptabilité et TVA               | `compliance/lot-4-accounting`  | Livré, CI verte                                                            |
| 5. KYC par niveaux                   | `compliance/lot-5-kyc`         | Livré                                                                      |
| 1 et 8. Localisation et exploitation | `compliance/lot-1-8-infra`     | Partie logicielle et configuration livrées ; hébergeur à choisir           |
| 6. Reversements                      | —                              | Non commencé : attend un prestataire agréé capable de séquestre (ADR 0014) |

Chaque branche part de la précédente : `compliance/lot-1-8-infra` contient l'ensemble.
