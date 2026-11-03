# Déploiement de pré-production (staging) — mode TEST

État au 03/11/2026 : **préparé, pas encore exécuté**. Hébergeur choisi : **Hetzner Cloud** (un serveur, environ 4 à 5 € par mois, prix à confirmer sur hetzner.com). Images construites et testées en CI (job `images`) ; Compose validé (`docker compose config`).

## Contenu

- `deploy/Dockerfile` : image unique du monorepo, cibles `migrate`, `api`, `worker`, `web`. Les réécritures `/v1` de Next sont figées au build : `API_INTERNAL_URL=http://api:4000`.
- `deploy/compose.staging.yaml` :
  - PostgreSQL 17 (bases `duoshop` et `zitadel`), migrations (job unique), API, worker, site web ;
  - Zitadel v4.19.4 et sa page de connexion Login V2 (d'après l'exemple officiel `deploy/compose` de Zitadel) ;
  - Caddy : TLS Let's Encrypt automatique pour `SITE_DOMAIN` et `AUTH_DOMAIN`, seul service exposé. L'API reste interne ; le site lui relaie `/v1/*`, webhooks compris.
- `deploy/staging.env.example` et `deploy/zitadel.env.example` : à copier en `deploy/staging.env` et `deploy/zitadel.env` (ignorés par Git).
- `deploy/postgres-init/10-zitadel.sh` : crée le rôle et la base `zitadel` au premier démarrage (volume vide).
- Données de référence (XAF, CM, fr/en) : migration `202611120001_reference_data`. Le seed de démonstration reste interdit en production.

## Ce qui fonctionnera, et ce qui manque encore

| Fonction                                          | État en ligne                                                                                            |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Catalogue, recherche, catégories, panier visiteur | ✅                                                                                                       |
| Création de compte et connexion (Zitadel)         | ✅ ; e-mails de vérification seulement si SMTP configuré                                                 |
| Espace vendeur, administration (MFA)              | ✅                                                                                                       |
| Paiement                                          | ❌ tant que les identifiants **sandbox CinetPay** manquent (le paiement simulé est refusé en production) |
| Photos produit                                    | ❌ tant qu'un stockage S3 n'est pas configuré (envoi refusé, 503)                                        |

## Mise en ligne sur Hetzner, pas à pas

### 1. Serveur (console Hetzner, par le titulaire du compte)

1. Créer le compte Hetzner Cloud et un projet `duoshop-staging`.
2. Sur le poste Windows, créer une clé SSH : `ssh-keygen -t ed25519`, puis copier le contenu de `~/.ssh/id_ed25519.pub`.
3. Créer le serveur :
   - type partagé x86, 2 vCPU et 4 Go de RAM (CX22 ou son successeur) ;
   - image **Ubuntu 24.04** ;
   - emplacement en Europe (Falkenstein, Nuremberg ou Helsinki) ;
   - clé SSH ci-dessus, aucun mot de passe root.
4. Pare-feu Hetzner : entrées autorisées TCP 22, 80, 443 uniquement.
5. Noter l'adresse IPv4, par exemple `203.0.113.10`.

### 2. Noms de domaine

Sans domaine acheté, utiliser sslip.io, qui résout le nom vers l'IP qu'il contient :

- `SITE_DOMAIN=duoshop.203-0-113-10.sslip.io`
- `AUTH_DOMAIN=auth.203-0-113-10.sslip.io`

Avec un domaine : deux enregistrements A, par exemple `staging` et `auth.staging`, vers l'IP du serveur.

### 3. Préparer le serveur

```sh
ssh root@203.0.113.10
apt update && apt -y upgrade && apt -y install git unattended-upgrades
# Docker, méthode officielle
curl -fsSL https://get.docker.com | sh
# Mémoire d'échange : la construction de Next.js dépasse parfois 4 Go
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
git clone https://github.com/fsonkwa-del/duoshopafrica.git /opt/duoshop
cd /opt/duoshop && git checkout sprints/1-8-mvp-foundations
```

### 4. Secrets et configuration

```sh
cd /opt/duoshop/deploy
cp staging.env.example staging.env && cp zitadel.env.example zitadel.env
openssl rand -hex 16   # ZITADEL_MASTERKEY (32 caractères)
openssl rand -hex 24   # à répéter pour chaque mot de passe ou secret
nano staging.env zitadel.env
chmod 600 staging.env zitadel.env
```

- `staging.env` : `SITE_DOMAIN`, `AUTH_DOMAIN`, `WEB_ORIGIN=https://<SITE_DOMAIN>`, `OIDC_ISSUER=https://<AUTH_DOMAIN>`, `POSTGRES_PASSWORD`, `LOGIN_SESSION_COOKIE_SECRET`. `OIDC_CLIENT_ID` reste vide jusqu'à l'étape 6.
- `zitadel.env` : `ZITADEL_MASTERKEY`, `ZITADEL_DB_PASSWORD`, le même mot de passe dans `ZITADEL_DATABASE_POSTGRES_DSN`, l'e-mail et le mot de passe du premier administrateur Zitadel. Mot de passe d'au moins 8 caractères avec majuscule, minuscule, chiffre et symbole.
- Les secrets ne quittent jamais le serveur : ni Git, ni messagerie. Les conserver aussi dans un gestionnaire de mots de passe.

### 5. Démarrage

```sh
cd /opt/duoshop
docker compose -f deploy/compose.staging.yaml --env-file deploy/staging.env up -d --build
docker compose -f deploy/compose.staging.yaml --env-file deploy/staging.env ps
```

La première construction prend plusieurs minutes. Ensuite :

- `https://<SITE_DOMAIN>/fr` affiche la boutique ;
- `https://<AUTH_DOMAIN>/ui/console` affiche la console Zitadel.

### 6. Application OIDC dans Zitadel

1. Console Zitadel : se connecter avec l'administrateur de l'étape 4.
2. Créer un projet `DuoShop`, puis une application **Web** avec la méthode **PKCE** (sans secret).
3. URI de redirection : `https://<SITE_DOMAIN>/v1/auth/callback`. Retour après déconnexion : `https://<SITE_DOMAIN>/fr`.
4. Dans « Token Settings », activer « User Info inside ID Token », comme en local.
5. Copier l'identifiant client dans `OIDC_CLIENT_ID` (`staging.env`), puis relancer :
   `docker compose -f deploy/compose.staging.yaml --env-file deploy/staging.env up -d api`.
6. Paramètres de connexion de l'instance : vérifier que l'inscription est autorisée, et activer la MFA (TOTP) pour le personnel.
7. Avant d'inviter des testeurs : configurer le SMTP (`zitadel.env`, ou console « Notification settings »). Sans lui, les e-mails de vérification ne partent pas.

### 7. Premier administrateur DuoShop

1. Se connecter une fois sur le site avec son compte Zitadel, et activer la MFA (TOTP) dans Zitadel.
2. Attribuer le rôle :
   `docker compose -f deploy/compose.staging.yaml --env-file deploy/staging.env exec api sh -c "cd /app && DUOSHOP_OPERATOR=<nom> pnpm platform:grant <email> ADMIN"`.
   Idem `FINANCE` pour la personne chargée des commissions.

### 8. Contrôles

- en-têtes `Content-Security-Policy` (nonce) et `Strict-Transport-Security` présents : `curl -sI https://<SITE_DOMAIN>/fr` ;
- `/fr/dev-login` répond 404 ;
- les logs de l'API montrent l'IP réelle des visiteurs ; sinon, ajuster `TRUST_PROXY_HOPS` ;
- `docker compose ... logs -f api worker zitadel` sans erreur.

### 9. Mises à jour, sauvegardes, arrêt

- Mise à jour : `git pull`, puis la commande `up -d --build` de l'étape 5. Les migrations s'appliquent seules.
- Sauvegarde quotidienne, à copier hors du serveur :
  `docker compose ... exec -T postgres pg_dumpall -U duoshop | gzip > /root/backup-$(date +%F).sql.gz`.
  La procédure de restauration est dans OPERATIONS.md.
- Hetzner facture à l'heure : supprimer le serveur arrête la facturation. Faire d'abord un instantané (snapshot) si besoin.

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
