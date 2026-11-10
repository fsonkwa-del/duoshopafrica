# Rapport de validation — 28 octobre 2026

## Résultat livré

Phase 0 : dossier de conception préparé, choix structurants en attente de validation.
Phase 1 : fondations préparées et vérifiées ; phase non terminée.
Le cahier et la configuration VS Code initiaux sont préservés. Le formateur avait ajouté des espaces de présentation ; ceux-ci ont été restaurés et ces fichiers sont désormais exclus.

## Fichiers créés

- README, configuration pnpm/Turbo/TypeScript/Biome/Vitest, lockfile exact, .env.example, .gitignore, .nvmrc et compose.yaml.
- apps/web : Next.js App Router FR/EN, racine redirigée vers FR, marque injectée, page de fondations et métadonnées noindex.
- apps/api : Fastify, OpenAPI, liveness 200/readiness 503 explicite, logs structurés et erreurs typées.
- apps/worker : point d'entrée inactif et arrêt sur signal ; aucun job métier annoncé exécuté.
- packages/config, types, i18n, ui, domain, sdk, database : marque, traductions, tokens UI, RBAC boutique, calcul exact de commission de simulation, client santé, sessions hashées et Prisma.
- Schéma core 15 modèles, migration SQL 202610280001_foundations, seed DEMO idempotent sans identifiants ni marchand actif, test DB composite inter-tenant.
- .github/workflows/ci.yml : contrôles et service DB ; workflow distant non exécuté.
- docs : vision, PRD, audit, architecture, catalogue de données/ERD, parcours, wireframes, design system, backlog, roadmap, sécurité, paiements, exploitation, plan de tests, questions et quatre ADR.

## Commandes réellement exécutées

Inspection : rg --files (y compris fichiers cachés hors .git), Get-Content du cahier intégral et des configurations, versions node/npm/pnpm/docker, commandes Git status/log/rev-parse/config. Git reste limité par propriété/arbre de travail ; aucune configuration globale ni commit modifié.
Versions : npm view sur les dépendances principales ; documentation primaire consultée, liens dans ADR 0002.

Contrôles via npx --yes pnpm@12.15.0 :
- install : premier passage échoué à cause des scripts de dépendances non autorisés ; approve-builds ciblé puis réussite.
- install --frozen-lockfile : réussite, lockfile à jour.
- db:generate et db:validate : réussite après ajout de l'unicité composite de MerchantVerification.
- prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script --output ... : migration versionnée générée.
- format puis lint : réussite finale sans avertissement ; erreur initiale de type Fastify corrigée.
- typecheck : 10 tâches réussies.
- test : 4 fichiers, 18 tests réussis (RBAC, calcul exact, i18n, tokens, contrats API).
- build : web, API et worker compilés ; Next génère /fr et /en.

## Vérification PostgreSQL réelle

Docker indisponible ; outils PostgreSQL 18.4 déjà présents utilisés pour une instance éphémère dans .local/pg-test (ignorée Git), loopback 127.0.0.1:15432, base duoshop_test, sans données utilisateur. Auth trust uniquement pour ce test isolé ; aucun réglage d'une instance existante changé.
initdb, pg_ctl start, createdb : réussite.
db:deploy : migration initiale appliquée avec succès.
db:seed exécuté deux fois : réussite, pas de duplication ni compte actif.
test:db : 1 test réussi, FK composite rejette membership tenant B vers boutique tenant A ; transaction annulée.
pg_ctl stop : instance arrêtée après tests ; données locales de test conservées, ignorées Git.
La cible Compose/CI reste PostgreSQL 17 ; exécution locale 18.4 ne remplace pas un résultat CI sous 17.

## Vérification web

Version compilée servie temporairement sur 127.0.0.1:3100.
HTTP /fr : 200, html lang=fr et bannière fondations ; /en : 200, html lang=en et bannière ; /ar : 404 ; / redirige et aboutit à FR 200.
Les requêtes HTTP ont nécessité une exécution hors sandbox (loopback bloqué dans la sandbox).
Tentative de contrôle via navigateur : pas de résultat exploitable ; aucune validation visuelle, mobile, clavier ou lecteur d'écran annoncée.
Contrastes calculés sRGB : primary/blanc 7,18:1 ; accent/fond 5,05:1 ; texte/fond 13,97:1. Pas de certification WCAG.

## Limites connues

Node local 26.2.0 ; cible Node 24 LTS non exécutée localement, CI distante non lancée. Docker Compose non démarré. Git ownership non réparé. Aucun test E2E Playwright, axe, charge, sauvegarde/restauration, fournisseur identité, webhook PSP, remboursement ou règlement réel.
Auth complète/OIDC/MFA, rôle runtime non-owner, RLS, dépôts bornés et isolation des lectures restent à livrer. Une FK et une fonction de permission ne prouvent pas le critère AC02 complet. Les modèles financiers/catalogue détaillés sont conceptuels ; seuls modèles core migrés. API non connectée à la DB ; aucun endpoint métier exposé. Worker sans queue, stockage S3 non branché, métriques/traces non intégrées.
Les critères MVP AC01–AC10 ne sont pas acceptés : leurs flux complets restent à construire. FR/EN/XAF et signalétique DEMO sont démontrés sur le socle ; aucune intégration de production. Aucun déploiement, achat, paiement ni engagement externe.

## Suite

Valider les propositions d'architecture/tenant, direction visuelle et objectifs d'exploitation ; choisir le fournisseur d'identité sans engagement payant automatique. Premier incrément : connexion → membre autorisé consulte sa boutique, API/UI/DB/RLS/audit et tests inter-tenant. PSP et juridique restent des dépendances bloquantes avant paiement réel.

---

# Sprint 1 — B01-a « Un membre autorisé consulte sa boutique » — 28 octobre 2026

Objectif : prouver l'isolation multi-tenant de bout en bout (DB → API → UI) sans attendre le choix du fournisseur d'identité. B01 n'est **pas** terminé : OIDC et MFA restent à livrer (B01-b).

## Livré

- Migration `202610290001_runtime_role_rls` : rôle `duoshop_app` NOLOGIN, non-owner, sans BYPASSRLS, endossé par `SET LOCAL ROLE` ; RLS sur User, Tenant, Store, StoreMember, MerchantVerification, AuditLog, OutboxEvent ; contexte `app.user_id` / `app.tenant_id` local à la transaction ; absence de contexte = aucune ligne. AuditLog : INSERT/SELECT seulement. Session : UPDATE limité à `revokedAt`.
- `@duoshop/database` : `asRuntime` / `enterTenant` (UUID validés), outil `pnpm dev:session` (DEV, interdit en production, boutiques DEMO et emails `@example.invalid` uniquement).
- `@duoshop/domain` : permission `store:read`, statut tenant explicite (PENDING : lecture seule ; SUSPENDED : rien).
- API : `GET /v1/me`, `GET /v1/stores/:storeId`, `POST /v1/auth/logout` ; cookie `__Host-session` ; 404 identique pour boutique inconnue, étrangère ou adhésion désactivée ; 403 tenant suspendu ; audit `store.view` / `store.view.denied` ; logout refusé sans Origin du site ; readiness 200 seulement si la base répond. Build API bundlé par esbuild (packages workspace TS inclus).
- Web : `/[locale]/account`, `/[locale]/account/stores/[storeId]` FR/EN, déconnexion par server action, route `/dev-login` désactivée (404) en build de production. SDK : `getMe`, `getStore`, `logout`.

## Commandes réellement exécutées (pnpm 12.15.0 via npx, Node 26.2.0)

- PostgreSQL 18.4 éphémère `.local/pg-test`, 127.0.0.1:15432 ; `db:deploy` : migration RLS appliquée.
- `format`, `lint` : OK. `typecheck` : 10/10. `test` : 4 fichiers, 21 tests OK. `build` : 3/3.
- `test:db` : 16 tests OK — FK composite (1), RLS (6 : sans contexte, A≠B par id deviné, adhésions propres, WITH CHECK audit, audit non modifiable, pas de fuite de contexte sur connexion réemployée avec pool=1), API (9 : sessions absente/malformée/révoquée/expirée, lecture + audit, A/B/inconnu = 404, adhésion désactivée, tenant suspendu 403 audité, /v1/me, 30 requêtes concurrentes entrelacées sur pool=2, logout Origin + révocation).
- Smoke : `node dist/main.js` + `next start` ; API ready 200, store 401 sans cookie / 200 avec session DEV ; pages FR et EN 200 avec rôle et statut traduits ; `/dev-login` 404 en production. Le smoke a révélé des dépendances runtime manquantes dans apps/api (corrigé).

## Limites connues

- Pas d'OIDC ni MFA : les sessions ne sont émises que par l'outil DEV. Pas d'expiration d'inactivité (12 h absolue seulement, valeur à valider).
- Session et Identity hors RLS (recherche par empreinte de jeton) ; RLS non forcée pour le propriétaire (migrations/seed).
- Pas de rate limiting, pas de CSP complète, pas d'E2E Playwright/axe, pas de vérification visuelle/mobile en navigateur.
- CI distante non exécutée ; Node 24 LTS et PostgreSQL 17 non testés localement.

---

# Sprint 2 — B01-b Connexion OIDC Zitadel et MFA — 28 octobre 2026

Décision utilisateur : Zitadel (ADR 0005 acceptée).

## Livré

- Migration `202610300001_oidc_login` : `LoginAttempt` (state haché, usage unique, 10 min), `Session.mfa` et `Session.lastSeenAt`, fonction `auth_link_identity` (SECURITY DEFINER, EXECUTE seul pour le runtime).
- API : `GET /v1/auth/login`, `GET /v1/auth/callback` (openid-client 6.8.8), `/v1/me` expose `mfa`, inactivité 30 min, 503 explicite sans fournisseur configuré, logs sans query string.
- Web : réécriture `/v1/*` vers l'API (origine unique), bouton « Se connecter », message d'échec FR/EN.
- `zitadel.smoke.ts` : smoke réel optionnel contre Zitadel local ; runbook dans OPERATIONS.md.

## Commandes réellement exécutées

- `db:deploy`, `db:generate` : OK. `format`/`lint` : OK. `typecheck` : 10/10. `test` : 21. `build` : 3/3.
- `test:db` : 29 tests OK (base 7, API 22 dont 13 OIDC contre un IdP simulé local : clés RSA réelles, PKCE vérifié, nonce/audience falsifiés, email non vérifié, state d'un autre navigateur, rejeu, expiration, redirection ouverte, MFA, inactivité).
- Zitadel v4.19.4 réel (binaire Windows, SHA-256 vérifié) sur PostgreSQL local : instance initialisée, projet et application OIDC créés par API, `zitadel.smoke.ts` exécuté deux fois avec succès : mot de passe → session `mfa=false` ; rejeu du callback refusé ; mot de passe + TOTP → `mfa=true`. Identités liées à l'issuer `http://localhost:8080` en base.
- Anomalie trouvée par le smoke réel et corrigée : le code d'autorisation et le state apparaissaient dans les logs de l'API. Après correction : 0 occurrence.
- Web en build de production sur :3000 : page compte FR 200 avec lien de connexion, message d'échec EN, `/v1/auth/login` via le web → 302 vers Zitadel avec cookie `__Host-login`.

## Limites connues

- Pas de login navigateur de bout en bout : l'interface Login V2 de Zitadel n'est pas installée, le smoke passe par l'API Session officielle. Pas de Playwright.
- MFA attestée mais pas encore exigée (aucune route admin avant B02). Pas de `end_session` Zitadel au logout. Pas de purge des `LoginAttempt` expirées (job worker à prévoir).
- Pas de rate limiting sur `/v1/auth/*`. Hébergement Zitadel staging/prod non décidé. CI distante non exécutée.

---

# Sprint 3 — B02 Approbation vendeur (AC01) et durcissement — 28 octobre 2026

## Livré

- Migration `202610310001_merchant_review` (conversion de `status` en enum sans DROP COLUMN) : `PlatformRole` ADMIN/SUPPORT, `PlatformMember`, `VerificationStatus`, champs déclaratifs et version optimiste sur `MerchantVerification`, `AuditLog.detail`. `app_platform_role()` SECURITY DEFINER ; politiques `staff_read` (lecture seule inter-tenant pour le personnel réellement inscrit) ; écritures toujours bornées au tenant entré.
- Domaine : `canPlatform` (MFA obligatoire, SUPPORT consulte, ADMIN décide), machine à états APPROVE/REJECT/SUSPEND, permission `store:verify` (propriétaire, tenant en attente).
- API : `POST /v1/stores/:id/verification`, `GET /v1/admin/verifications`, `POST /v1/admin/verifications/:id/decision` (motif ≥ 10 caractères, `expectedVersion`, refus de décider sur sa propre boutique, décision + tenant + audit dans une transaction), `GET /v1/admin/stores/:id/audit`. Non-personnel : 404 ; personnel sans MFA : 403 `mfa_required`.
- Durcissement : 20 tentatives/min/IP sur `/v1/auth/*` (429), validation JSON stricte (champ inconnu = 400), gestionnaire d'erreurs appliqué à toutes les routes sans message interne, purge des `LoginAttempt` par le worker (toutes les 15 min), outil `pnpm platform:grant`.
- Web FR/EN : section vérification sur la page boutique, `/[locale]/admin/verifications` (filtre, décision motivée), `/[locale]/admin/stores/[id]/audit` (heure de Douala).

## Commandes réellement exécutées

- `db:deploy` puis `migrate diff` : aucune dérive schéma/base. `format`/`lint` OK, `typecheck` 10/10, `build` 3/3.
- `test` : 28 tests (dont machine à états, politique plateforme, parité i18n profonde, fuseau Douala).
- `test:db` : 46 tests (base 8 dont purge ; API 38 dont 15 B02 : origine, propriétaire seul, déclaration invalide, double soumission, non-personnel 404, MFA requise, SUPPORT lit en inter-tenant sans décider, motif et version, **rollback réel** (droit INSERT sur l'audit retiré) sans demi-état ni fuite d'erreur, **deux admins simultanés : un seul gagne, un seul audit**, notes d'approbation masquées au vendeur, audit consultable, conflit d'intérêts, refus motivé puis nouvelle soumission, suspension bloquante ; limitation 429).
- Smoke interface (builds de production, formulaires soumis sans JavaScript donc server actions réelles) : vendeur soumet → file admin EN → motif trop court refusé avec message localisé → approbation → audit FR → vendeur voit « Active / Approuvée » ; vendeur refusé sur la page admin. Worker : purge exécutée. Données de démonstration remises à l'état initial.
- Anomalies trouvées et corrigées pendant le sprint : (1) Fastify retirait silencieusement les champs inconnus au lieu de les refuser ; (2) le gestionnaire d'erreurs n'était pas hérité par les routes en plugin, ce qui exposait le message interne des erreurs 500.

## Limites connues

- Session admin du smoke créée en base avec `mfa=true` (attestation réelle Zitadel prouvée au Sprint 2, pas rejouée ici). Pas de Playwright ni de contrôle visuel/lecteur d'écran.
- Pas de pièces justificatives (stockage privé, rétention non validés). Pas de réactivation après suspension. Attribution des rôles plateforme non auditée en base (outil d'exploitation). Limitation en mémoire locale (Redis requis en multi-instance). La lecture de la file par le personnel n'est pas journalisée.

---

# Sprint 4 — B03 Catalogue et inventaire (AC03 hors photos, AC06) + clôture B02 — 29 octobre 2026

## Livré

- Migrations `202611010001_catalog_inventory` et `202611010002_reservation_expiry` : Product, ProductVariant (prix BigInt en unités mineures, devise), InventoryLocation, StockLevel, StockMovement (append-only, idempotent), StockReservation (référence idempotente, expiration), PlatformAudit. Clés composites incluant `tenantId`, RLS sur toutes les tables, CHECK en base (prix > 0, stock et réservé ≥ 0, réservé ≤ stock, mouvement non nul, quantité > 0). `release_expired_reservations()` SECURITY DEFINER pour le worker.
- `@duoshop/database` : `adjustStock`, `reserveStock`, `releaseReservation`, `releaseExpiredReservations` — UPDATE conditionnels uniques, sans lecture-puis-écriture.
- Domaine : `catalog:publish` et `inventory:write`, préparation (brouillons, stock) autorisée pendant l'examen, publication seulement une fois approuvé ; prix entiers stricts, SKU normalisés, cycle de vie produit, décision `REINSTATE`.
- API : liste et création de produits (variantes), statut (version optimiste), prix (historique dans l'audit), mouvements de stock (clé d'idempotence, rejeu sans effet).
- Web FR/EN : page Catalogue (création, publication, réception, correction, prix), clé d'idempotence fixée au rendu de chaque formulaire de stock ; bouton « Lever la suspension » côté admin.
- Worker : libération des réservations expirées toutes les minutes. `platform:grant` journalise chaque opération dans `PlatformAudit` (opérateur, avant/après) dans la même transaction.
- ADR 0006 (photos et stockage objet) proposé.

## Commandes réellement exécutées

- Migrations appliquées, `migrate diff` vide. `format`/`lint` OK, `typecheck` 10/10, `build` 3/3.
- `test` : 36 tests. `test:db` : 68 tests (base 19, API 49).
- **AC06** (pool réel de 10 connexions) : 100 réservations simultanées sur un stock de 10 → exactement 10 acceptées, 90 refusées, 0 erreur, stock réservé = 10 ; 50 retraits simultanés de 1 sur 10 → exactement 10 appliqués, stock 0, 10 mouvements ; contrainte CHECK refusant un stock négatif même hors service ; même clé envoyée deux fois au même instant → appliquée une fois ; libération concurrente (5 fois) → une seule restitution ; autre tenant incapable de réserver ou d'ajuster.
- API catalogue (10 tests) : brouillon pendant l'examen, publication refusée puis permise après approbation, transitions invalides, prix inexacts, SKU dangereux ou dupliqués, champs inconnus, unicité SKU par tenant, rôles catalogue/préparation, idempotence et conflit de clé, stock insuffisant, historique de prix, isolation par identifiants devinés, boutique suspendue.
- `platform:grant` exécuté : attribution, révocation, compte inconnu refusé, deux lignes `PlatformAudit` avec opérateur.
- Smoke interface (builds de production, formulaires sans JavaScript) : création à 2 variantes → prix décimal refusé → réception de 12 avec **double envoi du même formulaire** (1 seul mouvement en base) → publication refusée en attente → publiée après approbation → prix modifié → correction sous le stock refusée → page EN (`FCFA 11,900`). Données de démo remises à l'état initial.

## Anomalies trouvées et corrigées

1. **Décalage horaire de toutes les dates écrites par l'application** (latent depuis le Sprint 1) : `@prisma/adapter-pg` envoie les dates sans fuseau ; PostgreSQL les interprétait dans le fuseau du serveur (Africa/Lagos, +1 h). Invisible tant que la base est en UTC (Docker/CI), faux dès qu'on compare avec `now()` en SQL : une réservation encore valide était libérée. Correctif : session forcée en UTC sur toutes les connexions (`createDatabase`), test de non-régression comparant une date écrite à `now()`. Les données locales antérieures sont décalées (base de test uniquement).
2. Une capture de `prisma migrate diff` avait inclus le bandeau « mise à jour disponible » de Prisma dans le SQL : migration refusée par PostgreSQL sans aucun effet partiel, marquée annulée, corrigée et réappliquée.

## Limites connues

- Photos produit absentes (ADR 0006 à valider). Pas de recherche ni de vitrine acheteur (B04). Réservations non encore utilisées par un panier (B05). Emplacement de stock unique (« Principal »).
- Smoke : la boutique DEMO a été passée en ACTIVE en base pour tester la publication (le flux d'approbation est couvert au Sprint 3). Pas de Playwright, pas de contrôle visuel mobile.

---

# Sprint 5 — Photos (ADR 0006), vitrine et panier (B04) — 29 octobre 2026

## Livré

- Migrations `202611020001_storefront_cart_media` et `202611020002_media_processing` : recherche plein texte (`tsvector` généré, `unaccent` immuable, index GIN) ; lecture publique par RLS (`public_read`) des seuls produits publiés de vendeurs actifs, via `tenant_is_active` / `product_is_public` / `variant_is_public` ; `Cart`/`CartItem` visibles par leur seul propriétaire (quantité 1–99 en CHECK) ; `ProductMedia` ; fonctions worker `pending_media` / `complete_media` (finalisation seulement depuis PENDING).
- API publique sans session : `GET /v1/catalog/products` (recherche, pages de 24, 120 req/min/IP), `GET /v1/catalog/products/:id`. Disponibilité en niveaux (en stock / stock faible / épuisé), jamais de quantité, de SKU ni d'identifiant de tenant.
- Panier : `GET /v1/cart`, `POST /v1/cart/items` (quantité cible, rejouable). Aucune réservation à l'ajout (anti-blocage de stock par des robots) ; prix et disponibilité recalculés à chaque lecture ; ligne devenue invisible affichée « indisponible » sans détail.
- Photos : package `@duoshop/media`, `POST /v1/stores/:id/products/:id/media`, tâche worker `process_media`, composant d'envoi direct navigateur → stockage, photos READY en vitrine.
- Web FR/EN : recherche dans l'en-tête et sur l'accueil, résultats, fiche produit (variantes épuisées désactivées), panier groupé par vendeur, retour vers la connexion si la session a expiré.

## Commandes réellement exécutées

- Migrations appliquées, `migrate diff` vide (colonne générée et index GIN déclarés dans le schéma). `format`/`lint` OK, `typecheck` 11/11, `build` 3/3.
- `test` : 43 tests (dont 5 sur de vraies images : métadonnées GPS supprimées, SVG/GIF/exécutable refusés, orientation, bombe PNG de 50 Mpx refusée, fichier tronqué).
- `test:db` : 89 tests (base 19, API 68, worker 2) — vitrine (visibilité selon statut produit et vendeur, recherche sans accents et par préfixe, injection inoffensive, pagination, aucune quantité exposée, 404 identiques), panier (origine, totaux exacts, produits cachés refusés, changement de prix signalé, stock insuffisant, double clic, isolation entre acheteurs, vendeur suspendu après l'ajout), photos (URL présignée, types/taille/texte alternatif, isolation, limite, 503 sans stockage, seules les photos READY visibles en FR/EN) et worker (image publiée propre en WebP 1200 × 675, SVG déguisé rejeté, envoi absent attendu puis abandonné, second passage sans effet).
- Smoke interface (builds de production, formulaires sans JavaScript) : vendeuse crée, approvisionne et publie → recherche anonyme « elegant » (FR) et « pagne » (EN) → fiche produit avec variante épuisée désactivée → ajout anonyme renvoyé vers la connexion → acheteur ajoute 2 (25 000 FCFA), passe à 3 (37 500 FCFA), quantité 120 refusée → dépublication : ligne « Article retiré de la vente ». Données de démo remises à zéro.

## Anomalies trouvées et corrigées

- Un cookie de session expiré faisait afficher une erreur générique à l'ajout au panier au lieu de proposer la connexion : redirection vers la connexion avec retour sur le produit.

## Limites connues

- **Stockage S3 non testé de bout en bout** : MinIO n'est plus distribué ; l'exécution du binaire SeaweedFS (empreinte MD5 publiée vérifiée, pas de SHA-256 fourni) a été refusée par le contrôle de sécurité de la session. Le traitement et l'API sont testés avec le stockage en mémoire, pas l'adaptateur S3 ni l'envoi navigateur (CORS).
- Panier réservé aux comptes connectés (pas de panier anonyme ni de fusion). Pas de checkout ni de paiement (B05/B06). Pas de Playwright ni de contrôle visuel mobile.

---

# Sprint 6 — B05 Checkout et commande (sans paiement) — 29 octobre 2026

## Livré

- Migration `202611030001_checkout_orders` : options de remise par boutique (frais de livraison fixes, retrait avec instructions, version), `Address` (quartier et repère obligatoires, téléphone E.164, GPS facultatif à 4 décimales), `Order` (parent acheteur, montants figés, clé d'idempotence unique par acheteur, empreinte de requête, adresse figée, échéance), `SellerOrder` (nom de boutique figé), `OrderItem` (titre, variante et prix figés). CHECK : total = articles + livraison, ligne = prix × quantité, quantités 1–99, téléphone, coordonnées. RLS : acheteur propriétaire de ses adresses et commandes, vendeur limité à ses sous-commandes. Fonctions `reserve_public_stock`, `close_unpaid_order`, `expire_unpaid_orders` ; les statuts de commande ne sont modifiables que par ces fonctions.
- API : `/v1/stores/:id/fulfilment`, `/v1/addresses` (création, liste, archivage), `/v1/checkout` (options par vendeur), `/v1/checkout/quote` (devis serveur), `/v1/orders` (passage, liste, détail, annulation), `/v1/stores/:id/orders` (vue vendeur sans données personnelles de l'acheteur, référence commune de commande).
- Worker : `expire_unpaid_orders` toutes les minutes. Domaine : normalisation des numéros camerounais, arrondi GPS, permission `store:configure`.
- Web FR/EN : checkout en deux étapes utilisable sans JavaScript (choix → devis serveur → confirmation avec clé fixée au rendu), mes commandes, détail et annulation, mes adresses, options de remise et commandes reçues côté vendeur.

## Règle de paiement respectée

Aucun statut « payé » n'existe encore. Une commande reste « en attente de paiement » 30 minutes avec son stock réservé, puis expire automatiquement et restitue le stock. L'interface l'annonce clairement. Aucun PSP n'est simulé.

## Commandes réellement exécutées

- Migration appliquée, `migrate diff` vide. `format`/`lint` OK, `typecheck` 11/11, `build` 3/3.
- `test` : 46 tests. `test:db` : 102 tests (base 19, API 81, worker 2), dont 13 pour B05 : adresse (repère, téléphone, GPS arrondi, isolation), options par vendeur, devis exact (33 000 + 1 500 = 34 500) et choix impossibles refusés, total modifié sans aucune réservation, commande parent + sous-commandes + réservations + panier vidé, rejeu à l'identique et clé réutilisée en conflit, vue vendeur sans données personnelles, prix modifié bloquant jusqu'à confirmation, **deux acheteurs pour la dernière pièce : une seule commande**, **double envoi simultané : une seule commande**, annulation (stock restitué une seule fois), expiration, réglages vendeur (rôle, montant entier, version).
- Smoke interface (builds de production, formulaires sans JavaScript) : vendeuse publie et fixe livraison 1 500 FCFA + retrait → acheteur ajoute 2 articles, enregistre une adresse (« 699 12 34 56 », repère) → devis 26 500 FCFA → **confirmation envoyée deux fois : une seule commande**, 2 pièces réservées, panier vidé → détail avec échéance à l'heure de Douala → vendeuse voit la commande (même référence), sans téléphone ni adresse → annulation : stock réservé revenu à 0 → liste EN. Données de démo remises à zéro.

## Anomalies trouvées et corrigées

- La vue vendeur échouait (500) en lisant la devise sur la commande parent, que la RLS réserve à l'acheteur : lecture sur les lignes de la sous-commande.
- Le vendeur voyait un numéro de sous-commande différent du numéro donné à l'acheteur : la référence commune de commande est affichée.

## Limites connues

- Pas de paiement (B06) : prestataire, contrat et sandbox requis. Données de livraison de l'acheteur jamais transmises au vendeur tant qu'aucun paiement n'existe.
- Frais de livraison fixes par boutique (pas de zones ni de poids). Pas de commission ni de facture (B08). Pas de notification (B07).
- Toujours non vérifiés : stockage S3 réel (exécution de SeaweedFS non autorisée), Playwright (téléchargement et exécution de navigateurs), contrôle visuel mobile.

---

# Sprint 7 — B06 Paiement : fondation paramétrable par opérateur (sans prestataire réel) — 29 octobre 2026

## Livré

- **ADR 0007 et paquet `@duoshop/payments`** : contrat `PaymentProvider`, registre lu depuis l'environnement, adaptateur MOCK signé HMAC-SHA256. Le mock est interdit en production : `providersFromEnv` lève une erreur.
- **Migration `202611040001_payments`** :
  - tables `PaymentMethod` (par opérateur), `Payment`, `ProviderEvent`, `ConfigAudit` ;
  - statut de commande `PAID` et mouvement de stock `SALE` ;
  - contact de livraison sur la sous-commande, rempli uniquement au paiement ;
  - CHECK sur les codes, préfixes, montants, téléphone et clé ;
  - RLS : catalogue lisible par tous, modifiable par un ADMIN seulement ; paiements lisibles par l'acheteur et le personnel ; événements lisibles par le personnel ;
  - fonctions `start_payment`, `record_payment_initiation`, `apply_payment_event`, et `close_unpaid_order` revue (pas d'annulation pendant une tentative récente ; tentatives expirées avec la commande).
- **API** :
  - moyens proposés pour une commande ; ouverture d'une tentative (idempotente, une seule à la fois, préfixe opérateur contrôlé) ;
  - webhook `/v1/payments/webhooks/:provider` lu en corps brut, rate-limité ;
  - simulateur MOCK, qui injecte un événement signé dans le vrai webhook ;
  - admin des moyens (création, mise à jour versionnée, audit) et liste des paiements à traiter.
- **Web FR/EN, sans JavaScript** : section paiement de la commande (choix du moyen, numéro, bandeau MODE TEST, attente, simulateur, historique des tentatives) ; contact de livraison côté vendeur après paiement ; pages admin « Moyens de paiement » et « Paiements à traiter ».

## Règles garanties et testées

- **Aucun statut payé sans webhook vérifié.** Un webhook non signé, falsifié, périmé (plus de 5 min) ou destiné à un prestataire inconnu est refusé, sans aucune écriture.
- **Doublons et contradictions** : deux envois simultanés du même événement donnent `APPLIED` + `DUPLICATE`, avec un seul décrément de stock. Un même identifiant porteur d'un autre contenu est mis en quarantaine.
- **Écarts** : un montant différent est mis en quarantaine et signalé sur le paiement. Un paiement inconnu est conservé comme orphelin.
- **Succès tardif** : un succès reçu après expiration de la commande est enregistré, mais la commande n'est pas confirmée et le stock n'est pas vendu. Il apparaît dans « Paiements à traiter » (remboursement manuel requis).
- **Données personnelles** : le vendeur reçoit le contact de livraison uniquement après paiement confirmé. L'acheteur ne voit que les 2 derniers chiffres du numéro payeur. Les logs ne contiennent ni téléphone ni secret.

## Commandes réellement exécutées

- Migration appliquée, `migrate diff` vide. `format` et `lint` OK, `typecheck` 12/12, `build` 3/3.
- `test` : 52 tests, dont 4 sur la signature mock et 2 sur le domaine.
- `test:db` : 113 tests (base 19, API 92, worker 2), dont 11 pour B06 :
  - droits d'administration (support en lecture, ADMIN sans MFA refusé, inconnu en 404) ;
  - validations de configuration ; versions et audit enable/disable ;
  - filtrage des moyens (sans adaptateur : non proposés) ;
  - téléphone et opérateur ; idempotence, tentative unique et annulation bloquée ;
  - webhooks rejetés ; succès concurrent dupliqué ; refus puis nouvelle tentative ;
  - succès tardif signalé ; montant erroné et orphelin.
- **Smoke interface** (builds de production, formulaires sans JavaScript, adaptateur MOCK) :
  - un admin MFA crée MTN Mobile Money (préfixes +23767, +23768, +237650), Orange Money (+23769, +237655) et une carte « cinetpay » ;
  - la carte est marquée « adaptateur non configuré » ; un code en double est refusé ;
  - l'acheteur commande 2 pagnes (26 500 FCFA) : seuls MTN et Orange lui sont proposés, avec la mention TEST ;
  - un numéro Orange choisi avec MTN est refusé avec un message clair ;
  - **un paiement envoyé deux fois ne crée qu'une tentative** ;
  - « Simuler : validé » donne la commande payée, le stock passe de 5 à 3 (vente −2, réservé 0), la vendeuse voit « Livrer à Awa Ngono · +237699123456 … » ;
  - un webhook forgé est refusé (401) ; la page EN est traduite ; un acheteur n'accède pas à l'administration.
- Le produit de démonstration a été créé par SQL pour ce smoke (le parcours catalogue a été validé par l'interface aux sprints 4 à 6). Données de démonstration remises à zéro et services arrêtés.

## Limites connues

- **Aucun prestataire réel n'est intégré ni testé.** AC05 reste ouvert jusqu'à une sandbox réelle (CinetPay, Flutterwave, MTN MoMo API, Orange Money API…) avec contrat.
- Pas de remboursement automatique (B09) : les succès à traiter le sont manuellement. Pas de rapprochement quotidien ni de journal comptable (B08).
- Moyens filtrés par devise, pas encore par pays. Frais de paiement non modélisés.
- La session admin du smoke a été créée en base avec `mfa=true` ; l'attestation Zitadel réelle est prouvée au Sprint 2. Pas de Playwright ni de contrôle visuel mobile.

---

# Sprint 7 bis — Parcours d'achat sans compte préalable et accueil « place de marché » — 29 octobre 2026

Demande utilisateur : un accueil façon Alibaba où l'on consulte les articles et remplit son panier avant d'avoir un compte. Le compte est créé au moment de commander, avec saisie de l'adresse de livraison ou choix du retrait en boutique. Couleurs inspirées de Pinduoduo.

## Livré

- **Panier visiteur** (migration `202611050001_guest_cart`) :
  - le cookie `__Host-cart` porte un jeton opaque de 32 octets, dont seule l'empreinte SHA-256 est stockée ;
  - CHECK « un seul propriétaire », RLS `guest_scope` via `app.guest_cart` ;
  - **fusion dans le panier du compte à la connexion** (quantités additionnées, plafond 99, idempotente et sûre en concurrence), y compris à l'ouverture du checkout ;
  - purge des paniers visiteurs inactifs depuis plus de 30 jours (worker).
- **Checkout** :
  - un visiteur voit l'étape « votre compte client » avec le récapitulatif ; son panier est conservé ;
  - une fois connecté, il saisit une nouvelle adresse directement dans le checkout (présélectionnée ensuite) ou choisit le retrait, qui ne demande pas d'adresse.
- **Accueil** : bannière, garanties (Mobile Money, livraison ou retrait, vendeurs vérifiés), encart vendeur, grille « Nouveautés ». Compteur du panier dans l'en-tête.
- **Couleurs** : palette rouge inspirée de Pinduoduo ; contrastes calculés dans DESIGN_SYSTEM.md.
- **Développement uniquement** (`DEV_LOGIN_ENABLED`, refusé en production) :
  - une page « Connexion de démonstration » remplace le message brut `identity_provider_not_configured` ;
  - le profil « Nouveau client » simule l'inscription.

## Commandes réellement exécutées

- Migration appliquée, `migrate diff` vide. Lint OK, typecheck 12/12, 52 tests unitaires.
- `test:db` : 121 tests (base 19, API 100, worker 2), dont 5 pour le panier visiteur et 3 pour la connexion démo. Un ancien test qui exigeait un compte pour le panier a été adapté à la nouvelle règle.
- Deux tests RLS ont été rendus indépendants des vitrines publiques présentes en base : ils échouaient pendant l'aperçu (boutique de démo active), sans défaut de code.
- **Smoke HTTP** (serveur de développement, formulaires sans JavaScript) :
  - un visiteur sans cookie ajoute 2 articles : le cookie panier est posé et le compteur affiche 2 ;
  - le panier est visible et le checkout montre l'étape compte (46 000 FCFA) ;
  - « Se connecter » mène à la connexion démo ; « Nouveau client » ramène au checkout avec le panier fusionné ;
  - commande en retrait sans adresse : créée ;
  - nouvelle adresse saisie dans le checkout : présélectionnée, total recalculé avec livraison ;
  - adresse invalide : message clair ; accueil EN traduit.

## Limites

- En production, la création de compte passe par Zitadel. L'**auto-inscription** doit y être activée, avec idéalement une inscription par téléphone : configuration non faite, aucune instance Zitadel de staging.
- Pas de commande sans aucun compte (« invité pur ») : choix conforme à la demande.
- Pas de catégories (modèle absent) ni d'ajout au panier depuis la grille de l'accueil. Pas de photos (stockage S3 non autorisé localement).

---

# Sprint 8 — B07 Livraison, preuve de remise et notifications — 29 octobre 2026

Priorité retenue : une commande payée était une impasse (ni préparation, ni suivi, ni preuve de remise), alors que la preuve de remise conditionne les commissions, reversements et litiges (B08/B09).

## Livré

- **Migration `202611060001_fulfilment`** :
  - statut de remise par sous-commande, avec version et compteur d'essais ;
  - `HandoverCode` : code à 6 chiffres tiré du générateur fort de PostgreSQL ; **RLS acheteur seul**, le vendeur ne peut que le soumettre ;
  - `FulfilmentEvent` : historique daté, visible du vendeur et de l'acheteur ;
  - `Notification` : propriétaire seul ;
  - déclencheur au passage en PAID : à préparer, code, premier jalon, notifications à l'acheteur et à l'équipe (propriétaire, gérants, préparateurs ; pas le rôle catalogue), événement outbox ;
  - fonction `advance_fulfilment` : transitions strictes (retrait : prête → remise ; domicile : prête → en livraison → remise ou échec → en livraison), motif obligatoire en cas d'échec, **remise uniquement avec le code de l'acheteur**, 5 essais puis blocage ;
  - reprise des commandes déjà payées.
- **Domaine** : permission `order:fulfil` (propriétaire, gérant, préparateur) et machine `nextFulfilmentSteps`, miroir du SQL.
- **API** : `POST /v1/stores/:id/orders/:sellerOrderId/fulfilment` (version optimiste, 30 requêtes par minute) ; `GET /v1/notifications` et `POST /v1/notifications/read`. La vue acheteur affiche statut, code et historique ; la vue vendeur affiche statut, historique et blocage, sans le code.
- **Web FR/EN, sans JavaScript** :
  - acheteur : statut, **code de remise** avec consigne, historique ;
  - vendeur : boutons de l'étape suivante, saisie du code et du motif ;
  - page Notifications et compteur de non-lues dans l'en-tête.

## Commandes réellement exécutées

- Migration appliquée, `migrate diff` vide. Lint OK, typecheck 12/12, build 3/3, 54 tests unitaires (dont 2 sur la machine à états).
- `test:db` : 127 tests (base 19, API 106, worker 2), dont 6 pour B07 :
  - jalons, code et notifications créés au paiement par un vrai webhook signé ;
  - le vendeur ne lit pas le code, ni en base dans son tenant, ni par l'API ;
  - le rôle catalogue est refusé (403), un inconnu reçoit 404 ;
  - étape sautée et version périmée refusées ;
  - parcours domicile complet : échec avec motif, mauvais code, bon code, historique de 6 jalons ;
  - retrait : 5 codes erronés bloquent la remise, même avec le bon code ensuite ;
  - notifications isolées par utilisateur.
- Le nettoyage d'un test de paiement existant a été adapté (jalons créés au paiement). Les restes laissés par l'exécution en échec ont été supprimés.
- **Smoke interface** (serveur de développement, formulaires sans JavaScript) :
  - nouveau client ; adresse saisie au checkout ; commande ; paiement MTN (simulateur) ;
  - l'acheteur voit le code (6 chiffres) et « À préparer » ; la vendeuse reçoit « Nouvelle commande payée à préparer » ;
  - la vendeuse enchaîne prête → en livraison → manquée (« Client absent, téléphone éteint ») → en livraison → mauvais code (« Code incorrect ») → bon code : « Remise au client » ;
  - historique de 6 jalons, code masqué après la remise, 6 notifications côté acheteur, page EN traduite, aucune erreur 500.

## Limites

- **Pas d'envoi SMS, WhatsApp ou e-mail** : les événements sont écrits dans l'outbox. Il faut un fournisseur (contrat, identifiants) et un expéditeur avec relances.
- Pas de partenaire logistique ni de suivi GPS du livreur ; la remise est prouvée par le code, pas par photo.
- Déblocage après 5 codes erronés : procédure de support à définir (aucun écran admin pour l'instant).
- Une boutique suspendue ne peut plus faire avancer ses commandes payées : politique à valider (remboursement ou prise en charge).
- La commande parent n'a pas de statut global « livrée » ; le suivi se fait par vendeur.

---

# Sprint 9 — B08 Commissions, journal en partie double et rapprochement — 29 octobre 2026

## Livré

- **Migration `202611070001_commission_ledger`** :
  - rôle plateforme **FINANCE**, séparé des opérations (le cahier impose de séparer l'opérationnel, la finance et la sécurité) ;
  - `CommissionRule` datée, propre à une boutique ou par défaut ; `LedgerJournal` et `LedgerEntry` (débit +, crédit −) ;
  - photographie de la commission sur `SellerOrder`, avec CHECK de cohérence du net vendeur ;
  - contrainte différée d'équilibre du journal ; aucune écriture ni modification possible par le runtime ;
  - écritures automatiques `order_paid`, `commission_earned` (remise prouvée) et `unapplied_payment` ;
  - fonction `finance_report` (balance, dû par vendeur, écarts, totaux journaliers à l'heure de Douala) ;
  - reprise de l'existant.
- **Domaine** : rôle FINANCE (`finance:review` et `finance:configure`) ; l'ADMIN consulte, le SUPPORT est exclu. Permission vendeur `earnings:read` (propriétaire, gérant ; maintenue pour une boutique suspendue).
- **API** : `GET/POST /v1/admin/commission-rules`, `POST /v1/admin/commission-rules/:id/close` (jamais rétroactif, audité), `GET /v1/admin/finance?from&to` (92 jours au maximum), `GET /v1/stores/:id/earnings`.
- **Web FR/EN** : pages admin « Commissions » (lecture seule hors FINANCE) et « Finance » (écarts, balance, dû par vendeur, par jour), page vendeur « Revenus » (en attente / acquis, brut, commission, net), profil démo « Finance plateforme ».

## Commandes réellement exécutées

- Migration appliquée, `migrate diff` vide. Lint OK, typecheck 12/12, build 3/3, 55 tests unitaires.
- `test:db` : 135 tests (base 19, API 114, worker 2), dont 8 pour B08 :
  - séparation des fonctions (FINANCE écrit, ADMIN lit, SUPPORT 403, inconnu 404) ;
  - règles non rétroactives, bornées, boutique inconnue refusée, audit ;
  - commande à deux vendeurs : règle de boutique 5 % (1 000) et défaut 4,5 % **half-up** (8 111 → 365, identique au domaine) ;
  - journal équilibré, total des fonds chez le PSP = montant payé ;
  - une nouvelle règle ne modifie pas une photographie passée ;
  - commission acquise seulement à la remise par code, revenus vendeur cohérents (rôle catalogue refusé) ;
  - paiement reçu pour une commande expirée : dû à l'acheteur ;
  - journal déséquilibré refusé à la validation ; runtime sans droit UPDATE/DELETE/INSERT ;
  - rapprochement sans écart pour ces paiements, période invalide refusée.
- Les tests de paiement et de suivi nettoient désormais leurs écritures comptables, qui n'ont pas de clé étrangère vers leur source.
- **Smoke interface** (formulaires sans JavaScript) :
  - le profil Finance crée « Simulation 5 % — pilote Douala » ; un effet rétroactif est refusé ; l'admin voit « Lecture seule » ;
  - la commande payée avant toute règle est signalée « sans règle de commission » ;
  - un nouveau client paie un pagne 12 yards (23 000 + 1 500) : commission 1 150, net 23 350, affiché « en attente » ;
  - remise par code : net « acquis » ;
  - Finance : fonds chez le PSP 41 000, dû vendeur 39 850, commissions acquises 1 150 ; seul écart, la commande d'avant la règle ; aucune erreur 500.

## Limites

- **Taux, base, arrondi et plan de comptes sont des hypothèses** à valider : commercial, expert-comptable, fiscalité (TVA sur commission non modélisée), frais PSP non modélisés.
- Pas de facture ni d'avoir numérotés (B08 étendu ou B12), pas de reversement (partenaire habilité requis), pas de relevé PSP importé.
- Pas de contrepassation outillée (B09 remboursements).

---

# Sprint 10 — B09 Retours, litiges et remboursements — 29 octobre 2026

## Livré

- **Migrations `202611080001_claims_refunds` et `202611080002_claims_staff_read`** :
  - tables `Claim`, `ClaimItem`, `ClaimEvent`, `Refund` (statut PENDING_PROVIDER) ;
  - RLS : acheteur, vendeur (tenant) et personnel en lecture ; aucune écriture directe ;
  - fonctions de transition et de remboursement :
    - `open_claim` : remise prouvée depuis 7 jours au plus, une réclamation active à la fois, quantités bornées par le non-remboursé, rejeu idempotent ;
    - `respond_claim` : vendeur, motif obligatoire pour refuser ;
    - `buyer_claim_action` : demande d'arbitrage ou retrait ;
    - `arbitrate_claim` : ADMIN seul ;
    - `decide_refund` : jamais au-delà de l'encaissé, commission reprise au même taux (half-up), plafonnée au reste ;
  - écriture `refund_decided` : dû vendeur −, commission −, dette envers l'acheteur + ;
  - `finance_holds` : dû vendeur gelé par les réclamations en cours ;
  - lecture des sous-commandes par le personnel, pour instruire les litiges.
- **Domaine** : machine `nextClaimSteps`, `canOpenClaim`, `claimHoldsPayout`, `commissionReversal` ; permission vendeur `claim:respond` (propriétaire, gérant) ; plateforme `claim:review` (support, admin) et `claim:decide` (admin).
- **API** : `POST /v1/orders/:id/claims`, `POST /v1/claims/:id/escalate|withdraw`, `GET /v1/stores/:id/claims`, `POST /v1/stores/:id/claims/:claimId/respond`, `GET /v1/admin/claims`, `POST /v1/admin/claims/:id/decide`. Les remboursements à exécuter apparaissent dans « Paiements à traiter », les gels dans Finance, le remboursé et le gelé dans Revenus.
- **Web FR/EN, sans JavaScript** :
  - acheteur : « Signaler un problème » (formulaire par article), suivi, demande d'arbitrage, retrait ;
  - vendeur : page « Réclamations », accepter ou refuser avec motif ;
  - admin : « Litiges à arbitrer » ;
  - notifications des deux côtés.

## Commandes réellement exécutées

- Migrations appliquées, `migrate diff` vide. Lint OK, typecheck 12/12, build 3/3, 59 tests unitaires (4 pour les litiges).
- Un `spawn EPERM` passager de Turbo sous Windows a été revérifié : relance OK, puis `tsc` paquet par paquet.
- `test:db` : 142 tests (base 19, API 121, worker 2), dont 7 pour B09 :
  - délai de 7 jours, remise non prouvée, autre acheteur 404, quantité excessive ;
  - gel du dû (29 500), rejeu idempotent, une seule réclamation active ;
  - le préparateur ne peut pas répondre, une autre boutique ne voit rien, motif obligatoire ;
  - arbitrage : le support instruit (403 pour décider), l'admin rembourse ;
  - écriture 19 000 / 1 000 / −20 000 ;
  - deuxième réclamation limitée au reste, commission jamais reprise deux fois (500 restants) ;
  - le retrait libère le gel.
- **Smoke interface** :
  - nouveau client : 2 sacs, paiement, remise par code ;
  - réclamation envoyée deux fois : une seule ;
  - refus sans motif bloqué, refus motivé, arbitrage demandé ;
  - l'admin voit « En arbitrage » (30 000) et rembourse : remboursement 30 000, commission reprise 1 500, dû vendeur −28 500, « en attente d'exécution par le prestataire » ;
  - revenus : remboursé −28 500, gelé 0 ; finance : à rembourser −30 000, aucun gel ;
  - notifications vendeuse et acheteur ; aucune erreur 500.

## Limites

- **Aucun remboursement n'est exécuté** : il faut un PSP réel (capacité de remboursement, webhook de confirmation, écriture REFUND_PAYABLE → PSP_CLEARING).
- Pas de logistique retour (étiquette, réception de l'article, remise en stock), pas de photos jointes (stockage S3), pas de rétrofacturation (chargeback).
- Délai de 7 jours, base articles hors livraison et arbitrage par l'ADMIN : hypothèses à valider (conditions générales de vente).

---

# Sprint 11 — B10 Qualification du pilote — 29 octobre 2026

Synthèse et décision dans [PILOT_READINESS.md](PILOT_READINESS.md) : **NO-GO** pour de l'argent réel (bloquants externes), **GO** pour une démonstration ou un test fermé en mode TEST.

## Livré

- **E2E Playwright 1.64.1**, version choisie pour correspondre au Chromium 1248 déjà présent sur le poste : aucun téléchargement de navigateur.
  - Builds de production démarrés par la configuration ; données créées puis supprimées (préfixe `e2e-`, tenant `TEST-E2E`) ; sessions injectées comme au retour OIDC.
  - Profils Pixel 7 et bureau ; axe-core 4.14.0.
  - Fichiers : `playwright.config.ts`, `e2e/buyer-journey.spec.ts`, `e2e/quality.spec.ts`, `e2e/support/*`. Commande : `pnpm build && pnpm test:e2e`.
- **Correctif mobile bloquant** (fieldset, `label` et `.stack` en grille rétrécissable, `max-width` des champs). Le test de largeur compare désormais à l'écran émulé.
- **Rate limit** des écritures acheteur (60 par minute et par IP) : panier, adresses, devis, commande, paiement, réclamation.
- `DATABASE_URL` déclarée dans `turbo.json`.

## Commandes réellement exécutées

- `pnpm test:e2e` : 42/42, deux fois. Premier passage 30/36, deux causes côté tests : pool PostgreSQL fermé trop tôt, cookie `__Host-` posé sur une URL http. Ensuite, le défaut mobile réel (bouton de confirmation inatteignable) a été diagnostiqué par trace Playwright et mesure DOM (522 px sur un écran de 412), puis corrigé.
- Lint OK, typecheck 12/12 (un `spawn EPERM` passager de Turbo, revérifié), build 3/3, 59 tests unitaires.
- `test:db` : 143 tests (base 19, API 122, worker 2), dont le nouveau test de rate limit (429 à la 61e requête).
- Sauvegarde et restauration réelles (`pg_dump -Fc`, `pg_restore` dans une base neuve) : comparaison identique, RLS active, `prisma migrate status` à jour, base supprimée.
- `pnpm audit --prod` : aucune vulnérabilité connue.

## Limites

- Les E2E ne tournent pas encore en CI. Pas de test de charge, pas de recette sur appareil réel, pas de test d'intrusion.
- CSP, HSTS et trustProxy sont à configurer avec l'hébergement.

---

# Sprint 12 — Préparation du passage au réel : CinetPay, sécurité, déploiement — 30 octobre 2026

Décisions utilisateur : prestataire **CinetPay** ; hébergement **non décidé** (images portables).

## Livré

- **Adaptateur CinetPay** :
  - initialisation, retour du payeur (simple redirection, sans valeur de preuve), notification en formulaire ou JSON ;
  - statut relu par appel serveur à serveur, empreinte de dédoublonnage ;
  - activation par l'environnement (SANDBOX par défaut) ;
  - contrat `PaymentProvider` étendu : vérification asynchrone, URL de notification et de retour, type de moyen.
- **CSP à nonce** (`apps/web/proxy.ts`, convention Next 16) : scripts limités au nonce, `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'self'`. HSTS et `upgrade-insecure-requests` seulement en HTTPS. Rendu dynamique garanti par la mise en page.
- **API** : `TRUST_PROXY_HOPS` (IP réelle derrière les proxies, sinon `X-Forwarded-For` est ignoré).
- **Déploiement** : `deploy/Dockerfile`, `deploy/compose.staging.yaml`, Caddyfile, modèle d'environnement, `.dockerignore`, `docs/DEPLOYMENT.md`.
- **CI** : E2E Playwright après le build ; job `images` qui construit les 4 cibles Docker.

## Commandes réellement exécutées

- Tests unitaires CinetPay sur API simulée (6) : initiation, refus, devise non prise en charge, statut relu, doublon de même empreinte, refus et attente, autre site, notification mal formée, panne (exception, donc nouvel essai), enregistrement SANDBOX/LIVE.
- `cinetpay.db.test.ts` (3, base réelle, réseau CinetPay simulé) :
  - redirection vers la page hébergée, mode SANDBOX ;
  - retour du payeur sans effet ;
  - notification d'un autre site refusée ;
  - corps falsifié (« ACCEPTED », montant 1) ignoré, statut relu « en attente » ;
  - statut accepté appliqué une fois, puis doublon.
- Un premier scénario de test était faux : CinetPay simulé se contredisait lui-même sur le montant, et la quarantaine était le bon comportement. Il a été corrigé.
- `guest-cart.db.test.ts` : rate limit par IP réelle derrière un proxy déclaré.
- E2E : **44/44** (nouveaux : en-tête CSP avec nonce, aucune violation CSP en console, y compris sur la page catalogue qui exécute du JavaScript).
- `docker compose config` : Compose de staging valide (6 services). Workflow CI analysé (YAML valide, 2 jobs).

## Non vérifié

- Aucun appel réel à CinetPay (pas d'identifiants ; documentation non joignable depuis le poste).
- Images Docker non construites localement (démon absent) : la CI s'en charge au prochain push. La CI distante n'a pas été exécutée (aucun push).

## Sprint 12 (suite) — Catégories façon place de marché

- **Migration `202611090001_categories`** :
  - taxonomie plateforme sur deux niveaux, garantis par un déclencheur ;
  - 6 rubriques et 15 sous-catégories adaptées à Douala, modifiables ;
  - RLS : lecture publique, écriture par l'ADMIN ;
  - `Product.categoryId` modifiable par le vendeur (droit `catalog:write`).
- **API** :
  - `GET /v1/catalog/categories` : arbre et nombre de produits publiés, rubrique comprenant ses sous-catégories ;
  - filtre `category` dans la recherche (sous-catégories comprises ; catégorie inconnue ou inactive : aucun résultat) ;
  - fil d'Ariane sur la fiche publique ;
  - `POST /v1/stores/:id/products/:productId/category` (audité), catégorie à la création ;
  - `GET/POST /v1/admin/categories` (permission `taxonomy:manage`, ADMIN).
- **Web** :
  - colonne des rubriques sur grand écran et bandeau défilant sur mobile (accueil, résultats) ;
  - fil d'Ariane ; pagination qui conserve le filtre ;
  - choix de catégorie dans le catalogue vendeur ;
  - page admin « Catégories ».
- **Tests** :
  - 5 tests sur base réelle : droits, comptage, filtre parent/enfant, fil d'Ariane, deux niveaux, identifiant unique, désactivation ;
  - E2E **50/50** : navigation rubrique → sous-catégorie → fiche avec fil d'Ariane, filtre exclusif, accessibilité et largeur mobile de la page filtrée ;
  - suites complètes : 65 tests unitaires, 152 sur base réelle (base 19, API 131, worker 2).

## Sprint 12 (suite) — Cartes cliquables et fiche produit façon place de marché

Demande utilisateur : toute la carte produit doit ouvrir la fiche (comme sur Alibaba), et la fiche doit s'inspirer de l'exemple fourni. La page d'exemple est rendue en JavaScript et l'outil n'en a lu aucun contenu : la structure suit la disposition usuelle des fiches Alibaba, sans en reprendre marque ni contenu.

- **Cartes** : le lien du titre recouvre toute la carte (un seul lien par carte pour les lecteurs d'écran), avec survol et focus visibles.
- **Fiche** :
  - galerie avec miniatures, sans JavaScript (`?photo=n`) ;
  - bloc d'achat : prix « à partir de » ou fourchette, options avec prix et disponibilité, quantité, **« Acheter maintenant »** (ajout puis checkout) et « Ajouter au panier » ;
  - encadré vendeur : boutique vérifiée, ouverte depuis, frais de livraison, retrait ;
  - garanties : paiement confirmé par le prestataire, code de remise, réclamation 7 jours ;
  - tableau des caractéristiques, description, produits similaires de la même catégorie.
- **API** : la fiche publique expose les options de remise du vendeur et son année d'ouverture.
- **Tests** :
  - E2E **56/56** : carte cliquée hors du titre (vrai clic de souris aux coordonnées du prix) ; encadré vendeur, garanties et caractéristiques ; « Acheter maintenant » mène au checkout ; largeur mobile ;
  - suites complètes vertes.
- **Pleine largeur** (remarque utilisateur : Alibaba occupe toute la page). Les pages boutique sont fluides, plafonnées à 1920 px, avec une marge latérale de 0,75 à 2,5 rem. En-tête blanc bord à bord et recherche élargie. Grille de 2 colonnes sur téléphone, dense sur grand écran. Les espaces vendeur et administration restent centrés (formulaires). E2E 56/56 relancé, contrôles de largeur mobile compris.

## Sprint 12 (suite) — Accueil et en-tête façon place de marché (captures fournies)

Design repris des captures d'Alibaba fournies par l'utilisateur, **avec l'identité DuoShopAfrica** : ni logo, ni nom, ni intitulés propres à Alibaba.

- **En-tête** : logo ; recherche en pilule (sauf accueil) ; « Adresse de livraison : Douala · CM » ; langue et devise ; icônes panier, notifications, commandes et compte avec pastilles. Seconde ligne : « Toutes les catégories », 3 rubriques, Mes commandes, Vendre sur DuoShop.
- **Accueil** :
  - fond dégradé ; onglets Produits / Catégories ; grande recherche arrondie avec bouton en dégradé ;
  - barre « Bienvenue » avec raccourcis ;
  - rangée : panneau des catégories (pictogrammes, chevrons, défilement) ; cartes « Nouveautés » et « Explorez : rubrique » (prix en pastille) ; **carrousel « À la une » en haut à droite, sous la recherche** (3 diapositives) ;
  - grille « Sélectionnés pour vous ».
- **Carrousel** : défile au doigt et points-liens sans JavaScript. Avec JavaScript : avance toutes les 6 s, pause au survol ou au focus, immobile si l'utilisateur préfère réduire les animations.
- **Cartes produit** : titre sur deux lignes, fourchette de prix, « Min. 1 pièce · N vendus », « ✓ Vérifié · N ans · CM · boutique ».
  - **Données réelles** : ventes = agrégat des mouvements de stock SALE (`product_units_sold`, migration `202611100001_public_sales`, 0 pour un produit non public) ; ancienneté = année d'ouverture de la boutique ; fourchette = prix min/max des variantes actives.
- **Barre de raccourcis flottante** (panier, notifications, haut de page) à partir de 768 px.
- **Accessibilité** : axe signalait le lien de langue (texte visible absent du nom accessible, WCAG 2.5.3), corrigé. Correspondance exacte du menu « Catégories » dans le test.
- **Tests** :
  - E2E **58/58** (nouveau test : carrousel présent sous la recherche, 3 diapositives, flèche « suivante » qui avance) ;
  - compteur de ventes vérifié en base (2 unités après paiement) ;
  - suites complètes vertes.
- **Sélecteur langue et devise** (capture fournie) : fenêtre déroulante avec flèche sous « 🌐 Français · XAF » (élément `<details>`, sans JavaScript), titre, texte, listes Langue et Devise, bouton « Sauvegarder » pleine largeur. La route `/switch-locale` renvoie vers la même page dans la langue choisie (chemins internes seulement, aucune redirection ouverte).
  - Devise : **XAF uniquement**, seule devise réellement gérée. Pas d'euro affiché sans conversion réelle.
  - Bouton orange de marque (#C2410C, 5,2:1) au lieu de l'orange vif (#FF6A00), illisible avec du texte blanc.
  - E2E **60/60** (nouveau test : ouverture, devise XAF, passage en anglais sur la même fiche, largeur mobile).

## Sprint 12 (suite) — Pleine largeur partout, menus encadrés, catalogue de démonstration illustré

- **Pleine largeur** : les 16 pages compte, vendeur, administration et connexion démo utilisaient encore la colonne centrale. `AccountShell` reprend l'en-tête blanc pleine largeur de la boutique.
- **Menus encadrés** : `SideNav` est un panneau blanc bordé avec pictogrammes ; la rubrique ouverte est en rouge (`aria-current`). Colonne de gauche fixe à partir de 900 px, bandeau défilant sur mobile. Menus : administration (7 rubriques) et gestion de boutique (5 rubriques).
- **Catalogue de démonstration** : 5 boutiques DEMO et 46 produits (15 sous-catégories, variantes, prix de test en XAF, stocks dont ruptures et stocks faibles).
  - 45 photos **libres** de Wikimedia Commons (domaine public, CC0, CC BY, CC BY-SA ; aucune NC ou ND), avec auteur, licence et source enregistrés ; une recherche sans résultat acceptable (njansang) reste sans photo.
  - Images ré-encodées par le même traitement que les envois vendeurs (WebP, métadonnées retirées), servies depuis `apps/web/public/demo-media` (exclu de Git).
  - Page **« Crédits photos »** (`/fr/credits`, lien en pied de page), obligatoire pour CC BY et CC BY-SA.
  - Script de développement `pnpm --filter @duoshop/worker demo:catalog` : refusé en production, idempotent, refuse de supprimer un catalogue qui a des commandes.
- **Incidents** :
  - le TLS de Python échouait derrière le VPN (certificat « expiré ») ; les téléchargements passent par `curl` (magasin Windows), vérification TLS conservée ;
  - limite de débit de Wikimedia : reprises espacées ;
  - l'API Openverse ne répondait pas ;
  - la première requête envoyée à Openverse contenait par erreur l'adresse e-mail de l'utilisateur dans l'en-tête User-Agent ; retiré de toutes les requêtes suivantes.
- **Tests** :
  - E2E **62/62**, l'API de test servant les photos (accessibilité et largeur vérifiées avec images) ;
  - nouveau test : page admin pleine largeur, menu latéral encadré, rubrique active, sans débordement mobile ;
  - 65 tests unitaires et 152 sur base réelle, verts avec le catalogue de démonstration en base.

## Sprint 12 (fin) — Première CI distante complète

Premier passage sur GitHub Actions (Linux, Node 24, PostgreSQL 17.6, base neuve). Trois défauts réels, invisibles sur le poste de développement (Windows, Node 26, PostgreSQL 18), ont été trouvés et corrigés :

- **Paiements impossibles sous PostgreSQL 17** : le contrôle différé d'équilibre du journal comptable s'exécutait, à la validation, avec le rôle runtime `duoshop_app`. La RLS lui cache les lignes du journal : journal vu vide, chaque paiement accepté était refusé (`unbalanced ledger journal`). PostgreSQL 18 exécute ces déclencheurs avec le rôle actif lors de l'insertion, d'où l'absence d'erreur en local. Correctif : migration `202611110001_journal_check_definer` (`assert_journal_balanced` en SECURITY DEFINER). La pré-production prévue (Compose, PostgreSQL 17) aurait été touchée.
- **Fusion du panier visiteur concurrente** : deux requêtes simultanées après la connexion lisaient le même panier visiteur ; la seconde échouait en supprimant un panier déjà fusionné. Correctif : verrou `FOR UPDATE` sur le panier visiteur (`apps/api/src/cart.ts`).
- **Débordement mobile avec polices larges** : la recherche de l'en-tête ne pouvait pas rétrécir sous la largeur naturelle du champ et du bouton (423 px sur un écran de 412 px, toutes les pages hors accueil). Correctif : `min-width: 0` sur `.header-search`. Vérifié à 360 et 412 px avec Verdana et DejaVu Sans.
- **Outillage** :
  - la préparation E2E crée `.local/` (absent sur machine neuve) ;
  - en CI, les échecs `test:db` (avec les erreurs du serveur PostgreSQL) et Playwright (rapporteur `github`) sont publiés en annotations, lisibles sans connexion.
- Résultat : CI GitHub Actions **entièrement verte** (run 41483778344) : migrations, données initiales, 152 tests sur base réelle, lint, typecheck, tests unitaires, build, E2E Playwright mobile et bureau, images Docker.

## Sprint 13 — Pré-production en ligne (Hetzner)

- Serveur Hetzner Cloud CX23 (2 vCPU, 4 Go, Ubuntu 24.04, Falkenstein), créé par API avec l'accord de l'utilisateur : clé SSH dédiée, pare-feu 22/80/443, Docker 29 et Compose 2.40 (paquets Ubuntu), 4 Go d'échange. Secrets générés sur le serveur (fichiers `deploy/*.env`, mode 600), jamais transmis.
- Compose complet en service : PostgreSQL 17, migrations, API, worker, site, Zitadel v4.19.4 + Login V2, Caddy (Let's Encrypt via sslip.io).
- Zitadel : compte machine `provisioner` (jeton lisible par le seul conteneur zitadel) ; projet `DuoShop` et application OIDC Web PKCE créés par l'API Management ; inscription autorisée.
- **Défaut trouvé** : en mode strict, Turborepo ne transmettait pas `API_INTERNAL_URL` au build Next ; l'image web relayait `/v1` vers `127.0.0.1:4000` (erreur 500 à la connexion). Corrigé dans `turbo.json` (`env`).
- Contrôles en ligne : `/fr`, `/fr/products` et `/fr/cart` répondent 200 ; `/fr/dev-login` 404 ; CSP avec nonce et HSTS présents ; `/v1/auth/login` redirige vers Zitadel, page de connexion 200.
- Non configuré : CinetPay sandbox (paiement), stockage S3 (photos), SMTP (e-mails de vérification).
- **Photos (03/11/2026)** : SeaweedFS 4.48 ajouté au Compose (`MEDIA_DOMAIN`, CORS limité au site, signatures vérifiées derrière Caddy, lecture anonyme du seul bucket public, buckets `duoshop-quarantine` et `duoshop-public`).
  - **Défaut trouvé** : le SDK AWS (sommes de contrôle par défaut) signait dans chaque URL présignée le CRC32 d'un corps vide ; tout envoi réel de photo échouait (`BadDigest`), sur SeaweedFS comme sur Amazon S3. Correctif : `requestChecksumCalculation: "WHEN_REQUIRED"` dans `packages/media/src/storage.ts`, test `storage.test.ts`.
  - Vérifié en ligne avec le code de l'application : envoi présigné 200 avec en-tête CORS du site ; taille différente 403 ; type différent 403 ; lecture anonyme de la quarantaine 403 ; lecture publique 200 ; origine étrangère refusée au pré-vol CORS ; CSP `img-src` et `connect-src` incluent le domaine des photos.

# Conformité — Lot 0 : socle (ADR 0008) — 10 novembre 2026

Plan de conformité validé par l'utilisateur le 10 novembre 2026 (`docs/compliance/PLAN.md`, ADR 0008 à 0016). Branche `compliance/lot-0-foundations`.

## Livré

- **Paramètres réglementaires datés** :
  - migration `202611170001_regulatory_parameters` ;
  - lecture à la date de l'événement ;
  - proposition par le rôle propriétaire, approbation par une autre personne ;
  - jamais rétroactif, sans chevauchement garanti par la base, audité.
- **Constantes remplacées** : délai de paiement (30 min), tentative de paiement (10 min), délai de réclamation (7 jours, lu à la date de remise), paniers visiteurs (30 jours). Les valeurs sont identiques, toutes « à valider ».
- **Écran d'administration** « Paramètres réglementaires » en français et en anglais : valeur en vigueur, propositions, historique.
- **Migrations réversibles** : `down.sql`, `pnpm db:down`, `pnpm db:roundtrip`. Le contrôle compare une empreinte du schéma : colonnes, contraintes, index, fonctions, droits, politiques RLS, déclencheurs, enums.
- **Flux sortants** :
  - `docs/compliance/flux-sortants.md` ;
  - `pnpm check:outbound`, qui échoue sur tout hôte externe non déclaré ;
  - `docs/compliance/registre.md`, première version du registre des traitements.
- **CI** : contrôle des flux sortants et aller-retour des migrations, avant les tests.
- `fapshi.db.test.ts` n'était pas dans la liste `test:db` de l'API : ajouté.

## Commandes réellement exécutées

- `pnpm db:deploy`, puis `prisma migrate diff` : aucun écart avec le schéma Prisma.
- `pnpm db:roundtrip` : descente puis remontée, « round trip ok (1917 schema facts) ».
- `pnpm check:outbound` : 3 hôtes déclarés en usage. Contrôle négatif : un fichier contenant un hôte inventé fait échouer la commande.
- `parameters.db.test.ts` (7 tests, base réelle) :
  - valeurs d'origine ;
  - accès ADMIN et FINANCE seulement (acheteur 404, SUPPORT 403) ;
  - refus : mauvais rôle, valeur invalide ou hors bornes, rétroactivité, fondement manquant, clé inconnue ;
  - approbation par soi-même refusée, refus sans motif refusé, approbation par FINANCE, double décision refusée ;
  - bascule de valeur à la date d'effet ;
  - conflit avec une période approuvée ;
  - écriture directe refusée au runtime ;
  - chevauchement refusé même au propriétaire.
- Suites complètes : lint, typecheck, 76 tests unitaires, 173 sur base réelle (base 19, API 152, worker 2).

# Conformité — Lot 7 : adaptations juridiques (ADR 0015) — 10 novembre 2026

Branche `compliance/lot-7-legal`, issue du lot 0.

## Livré

- **Médiation au lieu d'arbitrage** : fonction SQL, permission, route (ancien nom gardé en alias), textes FR/EN.
- **Droits de l'acheteur** : échéance de réclamation affichée, calculée en base à partir de la date de remise et du paramètre daté. Rappel provisoire de la garantie légale et du droit de saisir le juge (H26).
- **Mentions légales** :
  - contact public de la boutique ;
  - mentions d'un vendeur vérifié sur la fiche produit, figées sur la commande ;
  - mention « prix toutes taxes comprises » ;
  - jamais le nom ni le téléphone privés du propriétaire.
- **Frais de livraison par quartier** :
  - 15 quartiers de Douala gérés par l'ADMIN ;
  - tarifs par quartier saisis par le vendeur, avec la valeur « non desservi » ;
  - devis serveur selon le quartier de l'adresse, montant figé sur la commande ;
  - compatibilité : le tarif fixe existant devient « toutes zones ».
- Textes de durée codés en dur retirés (« 30 minutes », « 7 jours ») : les délais sont des paramètres.
- **Défaut trouvé et corrigé pendant les tests** : avec des tarifs par quartier, le montant « dès » affiché était le tarif « toutes zones » au lieu du plus bas.

## Commandes réellement exécutées

- `prisma migrate diff` : aucun écart. `pnpm db:roundtrip` : 4 migrations réversibles défaites puis réappliquées, « round trip ok (2012 schema facts) ».
- `legal.db.test.ts` (4 tests) :
  - contact : propriétaire seul, numéro et e-mail validés ;
  - mentions exactes sur la fiche, sans nom ni téléphone privés ;
  - aucune mention pour une boutique non vérifiée ;
  - mentions figées sur la commande malgré un changement de contact ultérieur.
- `zones.db.test.ts` (3 tests) :
  - quartiers publics, gestion ADMIN seule, désactivation ;
  - tarifs : propriétaire seul, montant invalide refusé ;
  - devis : tarif du quartier, repli « toutes zones », quartier non desservi refusé (`zone_not_served`), quartier inconnu refusé, quartier repris comme précision ;
  - montant figé sur la commande.
- `claims.db.test.ts` : route `/mediate`, refus du SUPPORT par l'alias `/decide`, échéance exposée (remise + 7 jours).
- Tests unitaires du domaine : tarif par quartier et offre affichée.
- Suites : lint, typecheck, 78 tests unitaires, 180 tests sur base réelle (base 19, API 159, worker 2).
