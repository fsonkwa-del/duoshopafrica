# Déploiement de pré-production (staging) — mode TEST

État au 30/10/2026 : **préparé, pas encore exécuté**. Aucun hébergeur n'est choisi. Le `Dockerfile` n'a pas pu être construit sur le poste de développement (démon Docker indisponible) ; la CI le construit (job `images`). Le Compose est validé (`docker compose config`).

## Contenu

- `deploy/Dockerfile` : image unique du monorepo, cibles `migrate`, `api`, `worker`, `web`. Les réécritures `/v1` de Next sont figées au build : `API_INTERNAL_URL=http://api:4000`.
- `deploy/compose.staging.yaml` : PostgreSQL 17, migrations (job unique), API, worker, site web, Caddy (TLS Let's Encrypt automatique). Seul Caddy est exposé ; l'API reste interne et le site lui relaie `/v1/*`, webhooks compris.
- `deploy/staging.env.example` : variables à copier dans `deploy/staging.env` (ignoré par Git).

## Mise en route sur un hôte Docker

1. DNS : `SITE_DOMAIN` pointe vers l'hôte ; ports 80 et 443 ouverts.
2. `cp deploy/staging.env.example deploy/staging.env`, puis remplir. Mot de passe PostgreSQL fort, secrets dans un coffre.
3. `docker compose -f deploy/compose.staging.yaml --env-file deploy/staging.env up -d --build`.
4. Premier administrateur : `pnpm platform:grant <email> ADMIN`, à exécuter dans un conteneur `api` ou par une session d'administration de la base ; idem `FINANCE`.
5. Contrôles :
   - `https://SITE_DOMAIN/fr` répond ;
   - en-têtes `Content-Security-Policy` (nonce) et `Strict-Transport-Security` présents ;
   - `/fr/dev-login` répond 404 ;
   - `/v1/../health/ready` n'est pas exposé publiquement : vérifier depuis le réseau Docker.
6. Sauvegardes : `pg_dump` quotidien hors hôte et test de restauration (procédure dans OPERATIONS.md), ou base managée avec PITR.

## Activer CinetPay en sandbox

1. Créer le compte marchand CinetPay et récupérer `apikey` et `site_id` du site de test ; les placer dans `CINETPAY_API_KEY` et `CINETPAY_SITE_ID`, avec `CINETPAY_MODE=SANDBOX`.
2. Notification déclarée chez CinetPay : `https://SITE_DOMAIN/v1/payments/webhooks/cinetpay`. Également transmise automatiquement à chaque paiement (`notify_url`).
3. Admin → Moyens de paiement : créer par exemple `MTN_MOMO_CM` et `ORANGE_MONEY_CM` avec le prestataire `cinetpay`. La page indique « Sandbox prestataire » si l'adaptateur est actif.
4. **Recette sandbox obligatoire avant tout LIVE**, avec preuves expurgées dans VALIDATION.md :
   - paiement accepté ;
   - paiement refusé ;
   - abandon ;
   - notifications répétées (doublon) ;
   - notification arrivant avant le retour du payeur ;
   - montant multiple ou non de 5 (règle à confirmer) ;
   - devise XAF.
5. Points à confirmer avec CinetPay ou en sandbox :
   - ordre des champs signés du jeton `x-token`, à ajouter en défense supplémentaire ;
   - liste exacte des statuts de `/v2/payment/check` ;
   - existence d'une API de remboursement (B09) ;
   - format de `payment_date`.

## Réglages de sécurité liés à l'hébergement

- `TRUST_PROXY_HOPS=2` (Caddy puis la réécriture Next) : vérifier en staging que les logs de l'API montrent l'IP réelle du client, sinon ajuster.
- CSP : `MEDIA_PUBLIC_BASE_URL` (images) et `S3_PUBLIC_ENDPOINT` ou `S3_ENDPOINT` (envoi de photos depuis le navigateur) sont ajoutés automatiquement aux origines autorisées.
- Le rate limit est en mémoire : une seule instance d'API tant que Redis n'est pas branché.
