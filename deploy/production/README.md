# Déploiement multi-machines (lots 1 et 8)

Profils indépendants de l'hébergeur (ADR 0009, ADR 0016) : des machines virtuelles Linux (Ubuntu 24.04) chez un hébergeur situé au Cameroun, reliées par WireGuard. **Aucun hébergeur n'est choisi ni commandé** : ces fichiers s'appliquent à celui qui sera retenu.

## Les trois rôles

| Rôle     | Compose                                       | Contenu                                                                              | Exposé sur Internet                         |
| -------- | --------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------- |
| `app`    | `compose.app.yaml`, `compose.monitoring.yaml` | Caddy, site, API, worker, Zitadel, stockage des photos, Redis, ClamAV, supervision   | 80 et 443 seulement (Caddy)                 |
| `db`     | `compose.db.yaml`                             | PostgreSQL 17 avec pgBackRest (archivage WAL continu)                                | Rien : joignable par WireGuard depuis `app` |
| `backup` | `compose.backup.yaml`                         | Dépôt S3 des sauvegardes (second site au Cameroun), exercice de restauration mensuel | Rien : joignable par WireGuard              |

## Mise en service

1. Copier `ansible/inventory.example.ini` en `inventory.ini`, renseigner les adresses et les clés publiques WireGuard.
2. `ansible-playbook -i inventory.ini ansible/site.yml` : durcissement SSH, pare-feu, mises à jour automatiques, Docker, WireGuard, puis services par rôle.
3. Secrets générés sur chaque machine (`/opt/duoshop/deploy/*.env`, mode 600), jamais transmis ni versionnés. Clé de chiffrement des sauvegardes conservée hors des deux sites.
4. Premier `pgbackrest --stanza=duoshop stanza-create`, puis vérifier `pgbackrest check`.

## Sauvegardes et restauration

- Archivage WAL continu, sauvegarde complète hebdomadaire, différentielle quotidienne (`deploy/db/pgbackrest.conf`). Chiffrement AES-256 côté client. Durées de rétention : `repo1-retention-*`, à aligner sur les paramètres de conservation.
- `scripts/restore-drill.sh` (chaque mois, machine `backup`) : restauration complète sur une base temporaire, contrôles (migrations, équilibre du journal comptable, politiques RLS, rôle runtime sans contournement de la RLS), métrique publiée pour la supervision.
- Restauration à un instant donné : `pgbackrest --stanza=duoshop --type=time --target="AAAA-MM-JJ HH:MM:SS+01" restore`.

## Supervision et alertes

`compose.monitoring.yaml` : Prometheus, Alertmanager, Grafana, Loki et Promtail, blackbox-exporter. Règles d'alerte dans `monitoring/alerts.yml` :
- site ou API indisponible ;
- paiement en attente depuis plus d'une heure ;
- journal comptable déséquilibré ;
- tâche du worker arrêtée ou en échec ;
- files de photos ou de KYC qui grossissent ;
- restauration mensuelle en échec ;
- certificat TLS proche de l'expiration.

## Vérifications automatiques (CI)

- `scripts/check-exposure.mjs` : dans chaque fichier Compose, seul Caddy publie des ports (80 et 443) ; PostgreSQL, SeaweedFS, Zitadel, Redis, ClamAV et les outils de supervision restent internes ; aucun service ne monte le socket Docker.
- `ansible-playbook --syntax-check` et `docker compose config` sur tous les profils.
- À faire depuis l'extérieur après chaque mise en service : `scripts/check-exposure-remote.sh <hôte>` (ports joignables depuis Internet).
