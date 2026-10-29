# ADR 0007 — Moyens de paiement paramétrables par opérateur

Date : 2026-10-29. Statut : accepté. Le principe a été demandé par l'utilisateur le 29/10/2026 (« rendre les moyens de paiement paramétrables selon opérateur »). Aucun prestataire réel n'est encore choisi.

## Contexte

Au Cameroun, l'acheteur paie surtout par Mobile Money (MTN, Orange), parfois par carte ou par virement. Les opérateurs, les plafonds, les préfixes de numéros et les prestataires d'agrégation (PSP) changent selon le pays et le contrat, et un même opérateur peut passer d'un PSP à un autre. Coder ces choix en dur obligerait à redéployer à chaque changement commercial. Le cahier interdit par ailleurs tout faux succès de paiement et toute conservation de données carte.

## Décision

- **Catalogue `PaymentMethod` administré** (rôle ADMIN plateforme, MFA, historique `ConfigAudit`, versions optimistes). Chaque moyen porte :
  - code, type (Mobile Money, carte, virement, portefeuille), opérateur, pays, devise ;
  - libellés et consignes FR/EN ;
  - préfixes E.164 acceptés : ils sont saisis par l'administration et jamais codés en dur, car les plages d'opérateurs évoluent ;
  - montants minimum et maximum, ordre d'affichage, activation ;
  - clé d'adaptateur de prestataire.
- **Secrets hors base.** Les identifiants des prestataires restent dans l'environnement ou le gestionnaire de secrets. La base ne référence qu'une clé d'adaptateur. Un moyen actif dont l'adaptateur n'est pas configuré dans l'environnement n'est jamais proposé, et l'admin le voit clairement.
- **Contrat `PaymentProvider`** (paquet `@duoshop/payments`) : `initiate`, puis `verifyWebhook` sur le corps brut (signature, fraîcheur, forme). Les modes sont MOCK, SANDBOX et LIVE, et chaque paiement mémorise son mode.
- **Adaptateur MOCK** (simulateur local, aucun argent) :
  - activé uniquement par `PAYMENTS_MOCK_ENABLED=true` avec un secret d'au moins 32 caractères ;
  - **refusé au démarrage si `NODE_ENV=production`** ;
  - il emprunte le vrai chemin webhook signé HMAC-SHA256 et horodaté ;
  - l'interface affiche « MODE TEST » partout.
- **Le serveur est la seule source de vérité.** Seul un webhook vérifié change un statut, via la fonction SQL `apply_payment_event`. Cette fonction persiste l'événement et son effet dans une seule transaction, et l'ACK n'est envoyé qu'après le COMMIT.

## Conséquences

- Ajouter un opérateur chez un PSP déjà intégré se fait sans déploiement. Ajouter un nouveau PSP exige un adaptateur, un contrat, une sandbox et des tests réels.
- Le filtrage se fait aujourd'hui par devise, car la commande n'a pas de pays. Il faudra aussi filtrer par pays avant toute expansion (B15).
- Les frais de paiement facturés à l'acheteur ne sont pas modélisés : ils attendent les tarifs contractuels.
