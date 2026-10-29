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
