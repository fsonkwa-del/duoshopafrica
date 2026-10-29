# Exploitation

## Environnements

Local : compose PostgreSQL/Redis loopback, secrets .env non versionnés, seed DEMO sans utilisateur ni paiement. Staging/prod : infrastructures et secrets isolés, comptes DB runtime/migrator séparés, stockage privé KYC distinct, TLS et rotation. Aucun déploiement livré ou autorisé.

## Observabilité

API : logs JSON Fastify, requestId et erreurs génériques ; cookies/tokens masqués. Liveness indique processus vivant ; readiness retourne 200 seulement si la base répond. Les URL journalisées sont tronquées avant la query string (code OIDC, state). Worker annonce foundation_idle et n'acquitte aucun événement.
Prochaine instrumentation : traces OpenTelemetry web→API→worker, métriques latence/erreurs, stock refusé, webhook rejeté/dupliqué, âge outbox, retries/dead-letter, écarts de rapprochement. Pas de PII dans labels. Alertes proposées : paiement incohérent immédiat, outbox > 5 min, taux erreur > 2 % pendant 5 min, sauvegarde absente 24 h. Seuils à confirmer au pilote.

## Runbooks à valider sur staging

- Migration : sauvegarde vérifiée, migrator dédié, approche expand/contract ; ne pas utiliser db push/reset en prod. Rollback applicatif seulement si schéma compatible ; migration corrective pour données, jamais suppression automatique.
- Sauvegarde : chiffrée quotidienne, isolation des clés, restauration mensuelle sur environnement isolé et vérification commandes/journal ; RPO 24 h/RTO 4 h proposés, pas encore mesurés.
- Paiement incohérent : geler uniquement opérations concernées, conserver preuve, relire statut PSP avec identifiant, rapprocher ; ne jamais forcer payé depuis UI.
- File bloquée : mesurer âge, vérifier DB/PSP, réexécuter avec même eventId et clé ; poison message en quarantaine.
- Incident tenant : suspendre accès, révoquer sessions, conserver audit et preuves minimales, analyser périmètre et obligations de notification avec conseil.

## Limites du local

Images Compose fixées par version, sans digest ni durcissement production ; patchs à revoir avant staging. PostgreSQL connecté à l'API via le rôle runtime (RLS). Pas de sauvegarde, TLS, métriques ni alerte réellement opérés. Git et moteur Docker doivent être remis en état avant les vérifications correspondantes.

## Zitadel local (développement, sans Docker)

Binaire officiel Windows v4.19.4, empreinte SHA-256 vérifiée contre `checksums.txt`, installé dans `.local/zitadel` (ignoré par Git). Il utilise une base `zitadel` dédiée du PostgreSQL local, en HTTP sur `localhost:8080` (loopback). Comptes `@example.invalid` uniquement ; clé maître et PAT locaux, jamais versionnés.

1. `config.yaml` (port 8080, `ExternalSecure: false`, PostgreSQL 127.0.0.1:15432) et `steps.yaml` (organisation DEV, admin humain, comptes machine `provisioner` et `login-client` avec PAT écrits dans `.local/zitadel`).
2. `zitadel.exe start-from-init --masterkeyFile masterkey.txt --config config.yaml --steps steps.yaml --tlsMode disabled` (clé maître : exactement 32 octets, sans fin de ligne), puis `zitadel.exe start` aux lancements suivants.
3. Avec le PAT `provisioner` : projet + application OIDC Web, `authMethodType NONE`, `devMode`, `idTokenUserinfoAssertion`, retour `http://localhost:3000/v1/auth/callback`. Identifiant client dans `.local/zitadel/client.json`.
4. API : `OIDC_ISSUER=http://localhost:8080 OIDC_CLIENT_ID=<clientId>` (HTTP accepté seulement pour localhost hors production).
5. Smoke réel : `npx tsx src/zitadel.smoke.ts` dans apps/api (API démarrée). Il crée des utilisateurs de test, se connecte par mot de passe puis mot de passe + TOTP via l'API Session v2 de Zitadel, et vérifie la session DuoShop, le refus du rejeu et `mfa`.

Login navigateur : Zitadel v4 redirige vers Login V2 (`/ui/v2/login`), interface non installée localement ; à faire avant tout test manuel dans un navigateur.

## Exigence d'exploitation : sessions PostgreSQL en UTC

L'adaptateur Prisma envoie les dates sans fuseau. `createDatabase` force `TimeZone=UTC` sur chaque connexion ; tout autre client applicatif (scripts, outils) doit faire de même. Un test (`maintenance.db.test.ts`) vérifie l'accord entre dates écrites et `now()`.

## Personnel plateforme et worker

- `pnpm platform:grant <email> ADMIN|SUPPORT|REVOKE` : attribue un rôle à un compte déjà connecté une fois via Zitadel. Opération privilégiée (connexion propriétaire de la base) à consigner dans le registre d'exploitation ; toutes les routes du personnel exigent une session MFA.
- Worker (`apps/worker`, bundle esbuild) : purge des tentatives de connexion expirées depuis plus de 24 h, au démarrage puis toutes les 15 minutes, avec le rôle runtime (DELETE limité à `LoginAttempt`). Logs JSON `job=purge_login_attempts`.
- Worker : libération des réservations de stock expirées toutes les minutes (`release_expired_reservations`, lots de 500, `SKIP LOCKED`), log `job=release_expired_reservations`.
- `platform:grant` écrit une ligne `PlatformAudit` (opérateur = `DUOSHOP_OPERATOR` ou utilisateur système) dans la même transaction que l'attribution.
- Limitation des tentatives d'authentification en mémoire du processus : à déplacer vers Redis avant tout déploiement multi-instance ; configurer `trustProxy` derrière le reverse proxy pour limiter par IP client réelle.

## Photos produit (ADR 0006)

- Variables (API et worker) : `S3_ENDPOINT` (absent pour un fournisseur AWS standard), `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_QUARANTINE_BUCKET` (privé), `S3_PUBLIC_BUCKET` (lecture publique via CDN). Web/API : `MEDIA_PUBLIC_BASE_URL`. Sans stockage : l'API répond 503 `media_storage_not_configured` et le worker journalise `process_media disabled`.
- Le bucket de quarantaine doit autoriser en CORS le `PUT` depuis l'origine du site (en-têtes `content-type`), rien d'autre ; règle de cycle de vie conseillée : suppression des objets de quarantaine après 24 h.
- Worker : `process_media` toutes les 30 s, un envoi absent depuis plus d'une heure est rejeté (`upload_missing`). Une seule instance de worker tant qu'un verrou de traitement n'est pas ajouté (le traitement est idempotent, mais travaillerait en double).
- Local : SeaweedFS 4.48 téléchargé dans `.local/seaweedfs` (non exécuté, autorisation requise).

## Commandes non payées

- Worker : `expire_unpaid_orders` toutes les minutes (lots de 200, `SKIP LOCKED`) : statut EXPIRED, sous-commandes alignées, réservations restantes libérées. Log `job=expire_unpaid_orders`.
- Une réservation libérée par `release_expired_reservations` avant l'expiration de sa commande n'est jamais restituée deux fois (passage ACTIVE → RELEASED unique).

## Paiements

- Variables : `PAYMENTS_MOCK_ENABLED` (`true` en local seulement ; le démarrage échoue si `NODE_ENV=production`) et `PAYMENTS_MOCK_SECRET` (au moins 32 caractères, aléatoire). Les secrets des PSP réels seront ajoutés avec leur adaptateur.
- Webhooks : `POST /v1/payments/webhooks/<provider>` (JSON brut, 64 Ko maximum, 600 requêtes par minute). La réponse 200 n'est envoyée qu'après persistance. 401 signifie une signature refusée (log `payment webhook rejected`, sans charge utile).
- Suivi : page admin « Paiements à traiter » (succès non applicables, événements en quarantaine ou orphelins). À consulter chaque jour tant que les remboursements sont manuels.
- Moyens de paiement : page admin « Moyens de paiement ». Le code est immuable ; toute modification est versionnée et tracée dans `ConfigAudit`.

## Panier visiteur et connexion de démonstration

- Le worker exécute `purge_guest_carts` avec la purge des tentatives de connexion (toutes les 15 min) : il supprime les paniers visiteurs inactifs depuis plus de 30 jours.
- `DEV_LOGIN_ENABLED=true` : profils de démonstration (`/fr/dev-login`), en local seulement ; le démarrage de l'API échoue si `NODE_ENV=production`.
- Zitadel (staging et production) : activer l'auto-inscription dans la politique de connexion pour que « Créer mon compte » fonctionne au checkout.

## Tests de bout en bout (Playwright)

- Prérequis : PostgreSQL local démarré, ports 3000 et 4000 libres, `pnpm build`.
- `pnpm test:e2e` démarre l'API (adaptateur MOCK) et `next start`, prépare les données `TEST-E2E`, exécute les profils Pixel 7 et bureau, puis nettoie tout. Résultats et traces en cas d'échec : `.local/e2e-results/`.
- Navigateur : Chromium 1248, déjà installé ; `@playwright/test` est figé en 1.64.1 pour lui correspondre.

## Sauvegarde et restauration (procédure testée le 29/10/2026)

1. `pg_dump -h <hôte> -U <propriétaire> -d <base> -Fc -f duoshop.dump`
2. `createdb <base_vérif>` puis `pg_restore -d <base_vérif> --no-owner --exit-on-error duoshop.dump`. Le rôle `duoshop_app` doit exister dans le cluster cible : il est créé par la migration `runtime_role_rls`.
3. Contrôles : `prisma migrate status` à jour ; mêmes nombres de migrations, commandes et lignes de journal ; solde du journal = 0 ; politiques RLS et déclencheurs présents ; `SET ROLE duoshop_app` sans contexte ne voit aucune commande.
4. En production : sauvegardes managées avec PITR et test de restauration mensuel, RPO/RTO à fixer avec l'hébergeur.
