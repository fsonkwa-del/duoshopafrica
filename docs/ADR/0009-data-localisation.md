# ADR 0009 — Localisation des données au Cameroun

Date : 2026-11-09. Statut : proposé (lot 1).

## Contexte

Hypothèse de travail donnée par le porteur de projet : la loi n° 2024/017 du 23 décembre 2024 imposerait que les données personnelles restent au Cameroun. **La portée exacte de cette obligation (H1 à H3 dans [hypotheses.md](../compliance/hypotheses.md)) n'a pas été vérifiée : À VALIDER PAR JURISTE.** Faute de validation, nous retenons l'interprétation la plus stricte : aucune donnée personnelle stockée ni traitée hors du Cameroun.

Aujourd'hui, tout tourne sur un seul serveur Hetzner en Allemagne, base comprise. Il contient déjà des données personnelles de test : comptes, e-mails, téléphones, adresses.

## Décision

1. **Profils de déploiement indépendants de l'hébergeur.** Ansible pour préparer des machines Ubuntu, Compose pour les services, un inventaire par environnement. Trois rôles de machines :
   - `app` : Caddy, site, API, worker, Zitadel ;
   - `db` : PostgreSQL seul, sans accès public, joignable uniquement depuis `app` par réseau privé ou tunnel WireGuard ;
   - `backup` : chez un second hébergeur ou dans un second centre de données au Cameroun.

   Aucun hébergeur n'est choisi par ce document. Les offres et tarifs de Cloudstore Africa, CAMTEL ou d'autres sont à demander ; rien n'est commandé sans accord.
2. **Sauvegardes** : pgBackRest (WAL continu, une sauvegarde complète par semaine, des différentielles par jour), dépôt sur la machine `backup`, chiffrement AES-256 côté client avec une clé gardée hors des deux sites. Restauration à un instant donné. Un script `restore-drill` restaure chaque mois sur une machine temporaire, vérifie les migrations, l'équilibre du journal comptable et les politiques RLS, puis publie le résultat dans la supervision. Les durées de rétention sont des paramètres datés.
3. **Faible débit** (1 à 4 Mbps côté serveur) :
   - catalogue public et photos WebP avec `Cache-Control` long et noms versionnés, plusieurs tailles d'image (`srcset`) ;
   - un cache local (Caddy ou Varnish) devant les pages publiques sans cookie ;
   - budget mesuré en CI : pages acheteur sous 200 Ko transférés au premier chargement en profil 3G (Playwright avec limitation réseau) ;
   - jamais de cache partagé pour une réponse avec cookie de session : `Cache-Control: private, no-store`, vérifié par test.

   **Conflit à trancher : CDN.** Un CDN étranger reçoit l'adresse IP de chaque visiteur, souvent considérée comme une donnée personnelle (H4). Le choix par défaut est donc une cache au Cameroun ; un CDN étranger seulement après validation.
4. **Flux sortants** : inventaire dans `docs/compliance/flux-sortants.md` (destinataire, données transmises, pays, base, masquage). La garde CI est décrite dans l'ADR 0008. Principes :
   - supervision, journaux et suivi d'erreurs auto-hébergés sur nos machines ;
   - aucun outil d'analyse d'audience externe ;
   - masquage avant tout envoi externe (adresse IP tronquée, téléphone réduit aux 2 derniers chiffres, aucun e-mail dans les journaux).
5. **Registre des traitements** : `docs/compliance/registre.md` pour la lecture, et table `DataProcessingRegistry` (finalité, base légale, catégories de données, personnes concernées, destinataires, durée de conservation sous forme de clé de paramètre, lieu de stockage, mesures de sécurité). Le worker de conservation (lot 2) lit les durées dans ce registre.
6. **Sortie de Hetzner** : migration complète vers le Cameroun, puis suppression des volumes et instantanés Hetzner, sur ton accord explicite.

## Conséquences

- L'hébergement local coûtera probablement plus cher, avec moins de services managés. L'exploitation de PostgreSQL et des sauvegardes reste à notre charge.
- Le domaine Zitadel et les certificats Let's Encrypt fonctionnent pareil. Let's Encrypt ne reçoit que des noms de domaine, aucune donnée personnelle.
- Fapshi reçoit des données de paiement. Le lieu d'hébergement de Fapshi est à demander (question P6).
