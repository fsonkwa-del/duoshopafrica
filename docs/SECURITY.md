# Sécurité et menace initiale

## Frontières de confiance

Navigateur non fiable ; API source de vérité ; webhook externe authentifié ; worker service interne ; DB et objets privés accessibles avec comptes dédiés. Aucun secret dans NEXT_PUBLIC, repository, logs ou fixtures. .env ignoré ; pas de données carte stockées.

## Menaces prioritaires et contrôles à livrer

- IDOR tenant et boutique : memberships serveur, contraintes composites, dépôts bornés, RLS non-owner et tests de fuite lecture/écriture/export/recherche/fichier.
- Prise de compte vendeur/admin : OIDC vérifié issuer/audience/nonce/state/PKCE, MFA selon rôle, révocation et rotation des sessions. Cookie __Host-session Secure HttpOnly SameSite=Lax Path=/, durée proposée 12 h absolue/30 min inactivité à valider ; CSRF token + Origin sur mutations même origine. Aucune route d'authentification encore branchée.
- Faux succès PSP/rejeu : signature sur corps brut, eventId unique, horodatage, transactions, confirmation serveur et rapprochement.
- Survente/double clic : réservation DB conditionnelle, verrou/version, idempotence, concurrence réelle et expiration.
- Escalade support/finance : séparation des droits, MFA, double contrôle des seuils sensibles, audit protégé.
- SSRF/médias : uploads directs présignés, MIME réel/taille, antivirus et réencodage, liste hôtes autorisés, blocage réseau privé si import distant ; pièces KYC privées à TTL court.
- XSS/SQLi : rendu échappé, pas de HTML marchand brut, validation JSON stricte, invariants de stock et de prix en contraintes CHECK, mouvements de stock append-only et idempotents, journal des attributions de rôles plateforme, vitrine publique bornée par RLS (publié + vendeur actif, sans quantités), preuve de remise par code acheteur à 6 chiffres (RLS acheteur seul, vérifié en base, 5 essais puis blocage, route limitée), notifications isolées par utilisateur, panier isolé par utilisateur ou par jeton visiteur (empreinte seule en base, RLS guest_scope, fusion à la connexion, purge 30 jours), connexion de démonstration refusée en production, paiements : webhook vérifié sur corps brut (HMAC/temps constant/fenêtre 5 min) avant toute écriture, événement unique par contenu, quarantaine des contradictions, secrets prestataires hors base, adaptateur MOCK refusé en production, configuration des moyens réservée à l'ADMIN MFA et auditée, commandes (acheteur) et sous-commandes (vendeur) isolées par RLS, statuts de commande modifiables uniquement par fonctions dédiées, aucune donnée personnelle de l'acheteur transmise au vendeur avant paiement, photos en quarantaine réencodées sans métadonnées (ADR 0006), paramètres Prisma, CSP à finaliser avec nonce et tests Next.js ; aucune CSP complète prétendue livrée.
- Abus : limites par IP/session/tenant, quotas import/export, anti-spam et modération, budget Redis contrôlé. Ces middlewares restent à intégrer.

## Vie privée et audit

Réduire PII dans logs/outbox ; repères/adresses privés ; localisation facultative. Audit actor/action/resource/tenant/request/time, sans mots de passe ou corps KYC ; droit INSERT seul pour runtime, export append-only et accès exceptionnel tracé à implémenter. Support et sécurité n'ont pas droits comptables implicites. Politique rétention, mineurs, consentement, portabilité et suppression à valider juridiquement ; pas de durée légale inventée. Email normalisé et preuve de vérification avant liaison Identity ; aucun lien automatique non vérifié.

## État et sortie

Livré : générateur de tokens 256 bits avec hash SHA-256, sessions révocables vérifiées côté serveur (cookie __Host-session), logout avec contrôle Origin, OIDC Zitadel (PKCE S256, state lié au navigateur et à usage unique, nonce, issuer/audience vérifiés, email vérifié obligatoire, redirection interne seulement), attestation MFA par amr exigée sur toutes les routes du personnel, lecture inter-tenant réservée au personnel inscrit en base (RLS staff_read), séparation des tâches (pas de décision sur sa propre boutique), limitation 20/min/IP sur l'authentification, validation JSON stricte, erreurs sans détail interne, inactivité 30 min, logs sans query string, rôle runtime non-owner + RLS deny-by-default, audit append-only pour le runtime, RBAC boutique avec statut tenant, redaction logs. Ceci ne remplace pas une authentification. Avant activation métier : revue OWASP ASVS/Top 10, test IDOR, CSRF, permissions, rate-limit, sauvegarde/restauration, scan dépendances et revue indépendante. Aucune conclusion de conformité ou audit sécurité externe.
