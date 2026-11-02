# Qualification du pilote (B10) — go / no-go

Date : 29 octobre 2026. Périmètre : pilote Douala, XAF, FR/EN, places de marché multi-vendeurs.

**Décision recommandée : NO-GO pour un pilote avec de l'argent réel.**

**GO pour une démonstration ou un test utilisateurs fermé** en mode TEST : paiement simulé clairement affiché, aucun argent réel. Le produit est fonctionnellement complet et vérifié ; les blocages restants sont externes (prestataire, juridique, hébergement), pas logiciels.

## Critères d'acceptation MVP

| Critère                                       | État | Preuve                                                                |
| --------------------------------------------- | ---- | --------------------------------------------------------------------- |
| AC01 Admin approuve un vendeur, audit         | ✅   | tests DB merchant, Sprint 3                                           |
| AC02 Isolation multi-tenant                   | ✅   | RLS + 142 tests DB, E2E rôles                                         |
| AC03 Produit, variantes, prix, photos, stock  | ⚠️   | photos non testées sur un vrai S3                                     |
| AC04 Rechercher, commander, suivre sur mobile | ✅   | **E2E Pixel 7 et bureau**, parcours complet                           |
| AC05 Paiement confirmé côté serveur           | ⛔   | chemin vérifié avec l'adaptateur MOCK uniquement ; **aucun PSP réel** |
| AC06 Stock jamais négatif en concurrence      | ✅   | tests de concurrence, Sprint 4                                        |
| AC07 Commissions exactes et traçables         | ⚠️   | implémenté et testé ; taux et plan de comptes **non validés**         |
| AC08 Remboursements                           | ⚠️   | décidés et comptabilisés ; **exécution PSP absente**                  |
| AC09 FR/EN + XAF                              | ✅   | parité i18n testée, E2E EN                                            |
| AC10 Livraison prouvée, notifications         | ⚠️   | code de remise ✅ ; SMS/WhatsApp non envoyés                          |

## Vérifications réalisées (Sprint 11)

- **E2E Playwright 1.64.1** sur builds de production (Chromium, profils Pixel 7 et bureau) : **42/42**. Ils couvrent :
  - le parcours visiteur → panier → compte au checkout → adresse saisie sur place → paiement (refus d'un numéro d'un autre opérateur, MOCK) → préparation → remise par code → réclamation → remboursement en attente PSP ;
  - axe WCAG 2.1 A/AA sans violation grave ou critique sur 6 pages publiques ;
  - absence de débordement horizontal ;
  - traduction EN ;
  - durcissement en production (pas de connexion démo, en-têtes) ;
  - accès admin refusé aux acheteurs ; séparation ADMIN / FINANCE.
- **Défaut bloquant trouvé et corrigé** : sur mobile, une adresse longue élargissait le formulaire de checkout (fieldset, grilles CSS). Le navigateur dézoomait et **le bouton « Confirmer la commande » devenait inatteignable**. Correctif dans `packages/ui/src/tokens.css`. Le test de mise en page compare désormais à la largeur réelle de l'appareil : l'ancienne mesure (`innerWidth`) masquait le problème.
- **Sauvegarde / restauration réelle** : `pg_dump -Fc` (240 Ko, < 1 s), restauration dans une base neuve (1 s). Comparaison identique : 15 migrations, commandes, lignes de journal (solde 0), 61 politiques RLS, 4 déclencheurs, 40 fonctions. La RLS est active après restauration et Prisma juge le schéma à jour. Base temporaire supprimée.
- **Dépendances** : `pnpm audit --prod` sans vulnérabilité connue.
- **Revue de sécurité** (ci-dessous) : la limitation de débit des écritures acheteur a été ajoutée et testée (61e requête par minute refusée en 429).

## Revue de sécurité

| Point                                                                                                   | État                                           |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Sessions opaques `__Host-`, httpOnly, Secure, SameSite=Lax, 30 min d'inactivité / 12 h                  | ✅                                             |
| Origin vérifiée sur toutes les mutations                                                                | ✅                                             |
| RLS sur toutes les tables métier, runtime non propriétaire, fonctions SECURITY DEFINER bornées          | ✅                                             |
| Personnel : rôle lu en base + MFA ; séparation ADMIN / SUPPORT / FINANCE                                | ✅                                             |
| Webhooks : HMAC sur corps brut, fenêtre de 5 min, idempotence, quarantaine                              | ✅                                             |
| Fonctions de développement (MOCK, connexion démo) refusées en production                                | ✅ testé E2E                                   |
| Journal comptable immuable pour le runtime                                                              | ✅                                             |
| Rate limit : connexion, catalogue, webhooks, remise, **écritures acheteur (nouveau)**                   | ✅                                             |
| Logs sans query string, sans secret ni téléphone                                                        | ✅                                             |
| CSP avec nonce par requête (`proxy.ts`, Sprint 12)                                                      | ✅                                             |
| HSTS envoyé en HTTPS uniquement (Sprint 12)                                                             | ✅ à vérifier en staging derrière Caddy        |
| IP réelle derrière proxy : `TRUST_PROXY_HOPS` (Sprint 12)                                               | ✅ à vérifier en staging (logs API)            |
| Rate limit en mémoire (une instance)                                                                    | ⚠️ Redis avant plusieurs instances             |
| Antivirus des images envoyées                                                                           | ⚠️ non branché (ADR 0006)                      |
| Test d'intrusion externe                                                                                | ❌ non réalisé                                 |

## Bloquants externes (décisions et accès requis)

1. **Prestataire de paiement** : contrat, sandbox, adaptateur, capacité de remboursement (AC05, AC08).
2. **Validation juridique et comptable** : CGV (délai de réclamation, arbitrage), statut d'intermédiaire de paiement (BEAC/COBAC), taux de commission, TVA, plan de comptes.
3. **Hébergement de staging** : PostgreSQL managé (sauvegardes, PITR), Zitadel avec auto-inscription, stockage S3, TLS et reverse proxy (CSP, HSTS, trustProxy), supervision.
4. **Fournisseur SMS / WhatsApp** pour les notifications externes.

## Hors périmètre de cette qualification

Tests de charge et de performance, recette manuelle (lecteur d'écran, appareils réels Android d'entrée de gamme sur réseau 3G), restauration à un instant donné (PITR, dépend de l'hébergeur), tests sur appareils réels. La CI distante (GitHub Actions, PostgreSQL 17, Linux) exécute toute la chaîne, E2E compris, depuis le 2 novembre 2026.
