# Plan de tests et preuves attendues

## Pyramide

Unitaires : politique RBAC, calculs exacts/arrondis, transitions, parité traductions et tokens. Intégration PostgreSQL : FK/RLS, tenant absent/inactif, transactions stock, outbox/idempotence/journal ; vraie DB et rôle runtime non-owner. Contrat API : schémas OpenAPI, validation/erreurs, pagination et scopes. E2E Playwright : FR/EN mobile, marchand approuvé → produit → panier → PSP sandbox → suivi → remboursement. Accessibilité : axe et contrôle clavier/lecteur d'écran ; performance : appareil modeste/réseau contraint et jeu représentatif.

## Cas critiques obligatoires

- AC01 : approuver autorisé crée décision+AuditLog dans même commit ; refus ou rollback n'active pas boutique.
- AC02 : A ne peut lire/modifier/chercher/exporter fichiers de B, y compris IDs devinés ; même tenant autre boutique sans membership interdit. RLS testée sans contexte et via pool avec réemploi de connexion.
- AC03/06 : stock initial 10, 100 demandes simultanées, exactement 10 réservations acceptées, aucun stock négatif ; TTL vs capture et retries.
- AC05 : signature invalide/ancienne rejetée, même eventId reçu 10 fois = une transition, événements hors ordre, retour frontend frauduleux sans effet, timeout PSP et rapprochement.
- AC07 : XAF zéro décimale, grands montants, demi-unités, règle changée après commande sans impact snapshot, totaux cohérents.
- AC08 : remboursement partiel, répété, échoué/pending, chargeback, inversion journal et somme comptabilisée équilibrée.
- Groupes : dernier siège concurrent, double clic, expiration simultanée au seuil, annulation et compensation, remise financée.
- Exploitation : restauration d'une sauvegarde, retry outbox après crash entre livraison et ack, notification non dupliquée.

## Contrôles du socle

pnpm lint / typecheck / test / build ; prisma validate et generate ; migration versionnée. pnpm test:db vérifie la FK inter-tenant, les lectures/écritures RLS du rôle runtime (sans contexte, A/B, réemploi de connexion) et l'API authentifiée (A/B, sessions, logout, concurrence). CI prépare base, migration et seed puis contrôles. CI écrite ≠ CI exécutée. VALIDATION.md contient les résultats locaux effectifs et les tests non exécutés ; aucun critère métier n'est coché par présence d'un simple test de healthcheck.
