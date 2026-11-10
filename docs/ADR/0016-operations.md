# ADR 0016 — Exploitation : supervision, Redis, antivirus, exposition, notifications

Date : 2026-11-09. Statut : accepté le 2026-11-10 ; livré pour la partie applicative et la configuration (lot 8).

## Décision

1. **Supervision auto-hébergée** sur la machine `app` ou une machine dédiée au Cameroun : Prometheus, Alertmanager, Grafana, Loki pour les journaux, et un suivi d'erreurs compatible Sentry auto-hébergé (GlitchTip). Alertes :
   - disponibilité du site et de l'API ;
   - taux d'erreurs ;
   - paiement en attente depuis plus d'une heure ;
   - écart de rapprochement ;
   - worker sans battement depuis 5 minutes ;
   - file de photos ou de KYC qui grossit ;
   - échec du test de restauration mensuel.

   Seuils en paramètres. Les alertes partent par e-mail et SMS, sans donnée personnelle dans leur texte.
2. **Redis** pour les limites de débit partagées entre instances. Si Redis tombe : refus par défaut sur l'authentification, la saisie du code de remise et les webhooks ; passage libre sur la lecture du catalogue. Ce comportement est testé.
3. **ClamAV** (`clamd`) dans le worker : chaque photo et chaque pièce KYC est analysée en quarantaine avant traitement. Un fichier infecté est rejeté, conservé à part pour enquête, puis signalé. Les signatures sont mises à jour quotidiennement.
4. **Exposition réseau** vérifiée par un script CI et un contrôle depuis l'extérieur : seuls 80 et 443 sont publics (plus 22 restreint par adresse). Ne doivent jamais être joignables depuis Internet : la console d'administration Zitadel hors chemins publics, l'API d'administration de SeaweedFS, PostgreSQL et le socket Docker.
5. **Notifications** :
   - **SMS** via un agrégateur camerounais, à sélectionner ; aucun nom n'est retenu dans ce document ;
   - **e-mail transactionnel** : un fournisseur reçoit l'adresse du destinataire ; voir le conflit ci-dessous ;
   - **WhatsApp Business** : l'API officielle passe par Meta, hors du Cameroun. **Conflit avec l'ADR 0009** : désactivé par défaut, activable seulement après validation juridique (H4) et avec consentement explicite de l'utilisateur.

   Les messages ne contiennent ni adresse ni contenu de commande au-delà de la référence et d'un lien.

## Conséquences

Plus de services à exploiter sur des machines plus modestes : la supervision doit rester légère (rétention courte des métriques et journaux, paramétrée).

## Mise en œuvre (10 novembre 2026)

- **Métriques.** `/metrics` (format Prometheus) sur jeton `METRICS_TOKEN`. La route n'existe pas sans jeton, et l'API reste interne : le site ne relaie que `/v1/*`. La fonction SQL `ops_metrics` fournit les compteurs, sans donnée personnelle : paiements en attente depuis plus d'une heure, paiements à traiter, événements en quarantaine, journaux déséquilibrés, files de photos et de KYC, demandes en retard, factures échues, âge et état de chaque tâche du worker (table `WorkerHeartbeat`, mise à jour à chaque passage).
- **Supervision.** `compose.monitoring.yaml` (Prometheus, Alertmanager, Grafana, Loki, Promtail, blackbox), sans port publié. Règles d'alerte dans `deploy/monitoring/alerts.yml`. Destinataires e-mail et SMS à renseigner : aucun fournisseur n'est retenu.
- **Redis.** Limites de débit partagées si `REDIS_URL` est défini. **Écart avec la décision** : en cas de panne de Redis, la limitation laisse passer partout, y compris sur les routes sensibles. Le module ne permet pas facilement un comportement par route, et l'alerte de supervision signale la panne. À revoir si un refus par défaut est exigé.
- **ClamAV.** Client `INSTREAM` sans dépendance. Pièces KYC analysées avant chiffrement ; photos analysées en quarantaine (fichier infecté rejeté et supprimé). Une panne de clamd laisse la photo en attente au lieu de la laisser passer.
- **Exposition.**
  - `scripts/check-exposure.mjs` (CI) : seul Caddy publie 80 et 443 ; la base et la sauvegarde ne publient que sur l'adresse WireGuard ; aucun service ne monte le socket Docker.
  - `scripts/check-exposure-remote.sh` vérifie la même chose depuis l'extérieur.
  - Caddy réserve la console et les API d'administration de Zitadel aux adresses `ADMIN_IPS` (par défaut, personne depuis Internet).
- **Notifications.** E-mails transactionnels (SMTP) des notifications de commande : événement, référence et lien seulement ; un seul envoi ; jamais vers une adresse anonymisée ou de test ; inactifs sans serveur SMTP.
  - **SMS** : aucun agrégateur retenu, pas d'adaptateur écrit.
  - **WhatsApp** : non activé (conflit avec la localisation, H4).
- **CI.** Nouveau job `infra` : profils Compose valides, contrôle d'exposition, `ansible-playbook --syntax-check`, `shellcheck`.
