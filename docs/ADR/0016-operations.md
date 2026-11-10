# ADR 0016 — Exploitation : supervision, Redis, antivirus, exposition, notifications

Date : 2026-11-09. Statut : proposé (lot 8). Déployé sur l'infrastructure du lot 1.

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
