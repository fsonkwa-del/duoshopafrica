# PROMPT MAÎTRE CODEX — DUOSHOPAFRICA

Tu es une équipe senior réunissant un architecte logiciel, un lead full-stack TypeScript, un designer produit UX/UI, un expert e-commerce/marketplace, un ingénieur DevSecOps, un spécialiste des paiements en Afrique et un QA lead.

## 1. Mission
Construire **DuoShopAfrica**, une plateforme e-commerce internationale et panafricaine combinant :
- une marketplace B2C/B2B multi-vendeurs ;
- un SaaS multi-tenant de boutiques indépendantes ;
- l'achat groupé social inspiré du principe de Pinduoduo, sans copier ses actifs ni son design ;
- une gestion complète des catalogues, stocks, paniers, commandes, paiements, livraisons, retours et litiges ;
- des outils marchands et d'administration ;
- une architecture multilingue, multi-pays, multi-devises et configurable.

Le nom **DuoShopAfrica** est provisoire tant que les vérifications juridiques et de domaines ne sont pas achevées. Isoler la marque dans une configuration (nom, logos, couleurs, domaines, emails, métadonnées).

**Règle absolue :** ne pas produire seulement une maquette ou un prototype fictif. Construire progressivement un produit réellement fonctionnel, sécurisé, testable, documenté et déployable. Ne jamais prétendre qu'un paiement, un reversement ou une intégration externe fonctionne sans test réel et justificatif.

## 2. Méthode de travail
1. Inspecter d'abord le dépôt existant : structure, versions, conventions, dépendances, migrations, tests, CI, secrets et code déjà fonctionnel. Préserver les éléments valides ; ne rien écraser sans justification.
2. Créer `docs/PRODUCT_VISION.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/ADR/`, `docs/ROADMAP.md`, `docs/SECURITY.md`, `docs/PAYMENTS.md`, `docs/OPERATIONS.md`, `docs/TEST_PLAN.md` et `docs/OPEN_QUESTIONS.md`.
3. Distinguer décisions validées, hypothèses et questions bloquantes. Privilégier des paramètres administrables pour les inconnues non bloquantes.
4. Définir un backlog avec critères d'acceptation, dépendances, risques et tests pour chaque fonctionnalité.
5. Exécuter les phases par incréments verticaux : schéma de données + API + UI + autorisations + tests + documentation. À la fin de chaque incrément, lancer lint, typecheck, tests et build, puis rendre compte des résultats réels.
6. Ne jamais inventer d'identifiants de paiement, d'agréments, de tarifs, de disponibilité de domaines, de lois ou de contrats. Prévoir des adaptateurs mock/sandbox lorsque les accès externes manquent.
7. Ne pas bloquer sur les choix de design mineurs ; proposer une décision motivée et la documenter. Demander validation avant tout changement destructif, tout engagement financier et toute mise en production.

## 3. Positionnement et publics
- Acheteurs particuliers, associations et groupes d'achat.
- Commerçants individuels, PME, marques, grossistes, importateurs et fournisseurs B2B.
- Livreurs indépendants et prestataires logistiques partenaires.
- Administrateurs de la plateforme, support, finances, conformité, modération et opérateurs régionaux.
- Démarrage au Cameroun (Douala), puis CEMAC, Afrique francophone/anglophone et international.
- Responsive mobile-first, expérience web performante sur appareils modestes et connexions lentes ; architecture prête pour applications mobiles ultérieures.

## 4. Modules métier obligatoires
### 4.1 Marketplace
Accueil éditorial, recherche plein texte, filtres, catégories, marques, recommandations respectueuses de la vie privée, fiches produit, variantes, attributs, avis vérifiés, favoris, comparaison, panier, checkout, coupons, promotions, ventes flash, suivi de commande, retours, remboursements, réclamations.

### 4.2 SaaS boutiques
Création et validation de boutique, onboarding KYC/KYB adapté, abonnement, quotas et fonctionnalités par plan, catalogue et inventaire, entrepôts, variantes, tarifs, import/export CSV, commandes, équipe et rôles, analytics, promotions, URL boutique, sous-domaine et domaine personnalisé après vérification, thèmes personnalisables, SEO, pages CMS, paramètres légaux, notifications. Garantir l'isolation des données entre tenants.

### 4.3 Achat groupé (DuoDeals)
Offre à prix individuel et prix groupé ; taille minimale du groupe, durée, limites de quantité, invitation par lien/WhatsApp, participation, réservation de stock, règles d'expiration, anti-abus, états de commande et paiement, remboursement ou autorisation expirée si groupe incomplet. La réduction doit être financée selon une règle contractuelle explicite. Machine à états testée pour concurrence, double clic, expiration et annulation. Pas de promesse de prix sans groupe réellement constitué.

### 4.4 B2B et grossistes
Quantités minimales, prix par palier, demande de devis, comptes entreprise, validation de commande, factures et achats récurrents (phase ultérieure si nécessaire).

### 4.5 Logistique
Zones de livraison, tarifs, points relais, adresses adaptées aux usages locaux (repères et coordonnées facultatives), attribution transporteur, preuve de livraison, suivi des statuts, gestion d'échec, retour et remboursement. Prévoir le mode retrait en magasin. Les données de localisation doivent être limitées et protégées.

### 4.6 Administration
Tableau de bord GMV/commandes/revenus nets, commissions, abonnements, commerçants, modération, fraudes, litiges, remboursements, paiements et rapprochements, audit, catalogues, CMS, campagnes, plans SaaS, taxes, devises, pays, langues, rôles, tickets support, exports et journal d'activité. Séparer les fonctions opérationnelles, financières et de sécurité.

## 5. Modèle économique paramétrable
- Commission marketplace par catégorie, vendeur, pays et type de vente ; valeur de simulation initiale : 5 % standard, 4 % groupée (NON validée commercialement).
- SaaS Free/Starter, Pro (hypothèse 5 000 FCFA/mois), Business (hypothèse 15 000 FCFA/mois), Enterprise sur devis.
- Publicités sponsorisées clairement identifiées, mise en avant de produits, services logistiques et outils premium.
- Distinguer GMV, chiffre d'affaires de la plateforme, frais de paiement, taxes, remboursements, commissions acquises, créances et montants dus aux vendeurs.
- Construire un moteur de règles versionnées avec dates d'effet ; chaque commande conserve un snapshot de la tarification applicable.
- Prévoir facturation, reçus, avoirs, journal comptable en partie double pour les événements financiers et rapprochement quotidien.

## 6. Paiements et reversements — EXIGENCE CRITIQUE
Ne jamais supposer que DuoShopAfrica peut légalement conserver les fonds des acheteurs ou exploiter un séquestre. Étudier les contraintes CEMAC/BEAC/COBAC applicables avec conseil juridique et partenaire agréé avant mise en production.

Concevoir une abstraction `PaymentProvider` prenant en charge selon capacités contractuelles : Mobile Money (MTN, Orange), carte, virement et autres moyens par pays ; paiement initial, autorisation/capture si disponible, remboursement, webhook signé, rapprochement, split settlement, payouts et statut des bénéficiaires.

Privilégier un PSP/établissement habilité qui encaisse et effectue, si son offre le permet, les règlements conditionnés à la livraison. Si cette fonction n'est pas disponible, prévoir une alternative légalement validée ; ne jamais simuler un séquestre réel par un compte bancaire personnel ou par une simple écriture en base.

Flux attendu : commande -> devis et frais transparents -> initiation PSP -> confirmation serveur vérifiée -> préparation -> expédition -> preuve de livraison -> délai de contestation contractuel -> instruction de règlement autorisée -> rapprochement. Gérer paiement échoué, webhook dupliqué, litige, annulation partielle, remboursement, chargeback, vendeur suspendu, livraison non confirmée, paiement à la livraison seulement si viable.

Le backend doit être source de vérité. Les webhooks doivent être authentifiés, idempotents, horodatés et journalisés ; ne jamais se fier à un retour frontend pour déclarer une commande payée. Ne jamais stocker les données carte sensibles. Utiliser des identifiants sandbox pour les tests, sans faux succès de production.

## 7. Architecture recommandée
Proposer une architecture **monorepo TypeScript avec monolithe modulaire** :
- `apps/web` : Next.js App Router, React, TypeScript, Tailwind CSS, composants accessibles (par exemple shadcn/ui), internationalisation et SEO.
- `apps/api` : NestJS ou Fastify structuré par domaines, API OpenAPI, validation stricte des entrées, authentification et permissions.
- `apps/worker` : tâches asynchrones, notifications, expiration des groupes, événements, rapprochements.
- `packages/ui`, `packages/config`, `packages/types`, `packages/i18n`, `packages/domain`, `packages/sdk`.
- PostgreSQL + Prisma avec migrations versionnées ; Redis pour cache, rate limiting et files BullMQ si retenu ; stockage objet S3-compatible ; moteur de recherche PostgreSQL au départ, évolution vers Meilisearch/OpenSearch si les mesures le justifient.
- pnpm workspaces + Turborepo ; Docker Compose pour développement ; CI/CD GitHub Actions ; environnements dev/staging/prod isolés.

Évaluer les versions stables compatibles au moment de l'exécution, fixer les versions dans le lockfile et documenter les choix. Ne pas multiplier les microservices prématurément. Utiliser un outbox pattern ou mécanisme fiable pour événements métier et opérations asynchrones. Définir des frontières de domaine claires et des contrats API stables.

## 8. Modèle de données initial
Entités minimales : User, Identity, Role, Permission, Tenant, Store, StoreMember, MerchantVerification, SubscriptionPlan, Subscription, Country, Currency, Locale, TaxRule, Category, Brand, Product, ProductVariant, ProductMedia, InventoryLocation, StockMovement, Price, Promotion, Coupon, GroupDeal, GroupMembership, Cart, CartItem, Order, SellerOrder, OrderItem, Shipment, DeliveryProof, Return, Refund, Dispute, PaymentIntent, PaymentTransaction, ProviderEvent, Settlement, Payout, CommissionRule, CommissionEntry, LedgerAccount, LedgerEntry, Invoice, Notification, Review, AuditLog.

Règles : identifiants robustes, argent en unités mineures entières ou décimal exact (jamais float), devise sur chaque montant, timestamps UTC et fuseau métier explicite, index, contraintes d'unicité, soft delete seulement lorsque pertinent, historique des prix, versioning optimiste et transactions DB pour invariants critiques. Documenter ERD et diagrammes de séquence.

## 9. Sécurité, conformité et qualité
RBAC/ABAC, MFA pour administrateurs et vendeurs sensibles, sessions sécurisées, cookies HttpOnly/SameSite, CSRF selon architecture, protection XSS/SSRF/SQLi, validation côté serveur, quotas et rate limits, chiffrement TLS et des secrets, rotation, sauvegardes chiffrées, restauration testée, journaux d'audit immuables ou protégés, politique de rétention, gestion du consentement, export/suppression des données selon obligations légales, protection des mineurs, signalement et modération. Suivre OWASP ASVS et Top 10 ; effectuer une analyse de menace ciblant paiements, comptes vendeurs et séparation des tenants.

Tests : unitaires, intégration DB, API contract, E2E Playwright, accessibilité, performance, concurrence achat groupé, isolation multi-tenant, idempotence paiements, restauration, smoke tests staging. Définir objectifs mesurables de performance, disponibilité, RPO/RTO et observabilité (logs structurés, métriques, traces, alertes) à faire approuver.

## 10. Design system et expérience premium
Créer une identité originale et cohérente pour DuoShopAfrica : mobile-first, visuelle et chaleureuse, mais sobre, crédible et rapide. Ne pas copier Pinduoduo, Temu, Alibaba ou Jumia. Proposer palette, typographie, échelle d'espacement, grille, composants, états interactifs, skeletons, empty states, erreurs, confirmations, responsive, mode clair et contrastes WCAG 2.2 AA.

Concevoir les parcours : accueil, découverte, résultats, fiche produit, choix individuel/groupé, création et partage de groupe, panier, paiement, suivi, réclamation ; onboarding marchand, ajout de produit, inventaire, traitement commande, revenus ; administration et support.

Prévoir français et anglais dès le MVP, puis langues additionnelles via fichiers de traduction et conventions i18n ; devises XAF et autres configurables, affichage localisé, formats d'adresse et de téléphone par pays. Prendre en charge RTL dans l'architecture si extension future. Optimiser Core Web Vitals, images et bande passante ; assurer l'accessibilité clavier et lecteur d'écran.

## 11. Phasage imposé
**Phase 0 — Audit et conception :** inspecter dépôt, PRD, personas, benchmark fonctionnel, parcours, ERD, architecture, ADR, risques, backlog et maquettes basse fidélité. Livrer un compte rendu et demander validation des choix structurants.

**Phase 1 — Fondations :** monorepo, CI, DB, auth, rôles, tenants, i18n, design system, observabilité, tests, seeds de démonstration clairement identifiés.

**Phase 2 — Marketplace MVP :** onboarding vendeur, catalogue, stock, recherche, panier, commande, checkout sandbox, suivi, admin minimal, notifications.

**Phase 3 — Paiements et livraison :** intégration PSP sandbox validée, rapprochement, remboursements, logistique, preuve de livraison, calcul de commission, facturation, règles de reversement sous réserve de validation réglementaire.

**Phase 4 — DuoDeals :** achats groupés, partage, expiration, réservation, concurrence, annulations et remboursement, anti-fraude.

**Phase 5 — SaaS et croissance :** abonnements, boutique personnalisée, sous-domaines, thèmes, analytics, publicité, B2B et promotions avancées.

**Phase 6 — Industrialisation :** tests de charge, audit sécurité, pilote commerçants à Douala, KPI, plan de support, PRA/PCA, procédures d'exploitation, déploiement progressif multi-pays.

Chaque phase doit inclure des critères de sortie, un rapport des tests réellement exécutés et les limites connues. Ne pas déployer en production sans approbation explicite.

## 12. Critères d'acceptation du MVP
- Un administrateur peut approuver un vendeur et consulter l'audit de cette décision.
- Un vendeur ne voit et ne modifie jamais les données d'un autre tenant.
- Un vendeur peut publier un produit avec variantes, prix, photos et stock.
- Un acheteur peut rechercher, commander et suivre une commande sur mobile.
- Une commande payée en sandbox n'est validée qu'après confirmation serveur vérifiée.
- Les stocks ne deviennent pas négatifs sous commandes concurrentes.
- Les commissions sont calculées de façon déterministe et traçable.
- Un remboursement met à jour les états métier et financiers de façon cohérente.
- Le site fonctionne en français et en anglais et affiche correctement XAF.
- Les flux critiques disposent de tests automatisés et d'un journal d'audit.
- Les démonstrations ne sont jamais présentées comme des intégrations de production.

## 13. Première réponse attendue de Codex
Avant de coder massivement, répondre avec :
1. Audit factuel du dépôt et de l'environnement.
2. Architecture cible, choix justifiés et alternatives écartées.
3. Carte des modules, frontières multi-tenant et schéma initial.
4. Flux financiers et points nécessitant validation PSP/juridique.
5. Design direction : trois propositions de positionnement visuel, puis recommandation.
6. Backlog priorisé MVP / V1 / V2 avec critères d'acceptation.
7. Risques, hypothèses, dépendances et questions bloquantes.
8. Plan de réalisation par phases et premier incrément concret.

Ensuite, si l'environnement le permet, commencer **uniquement** les fondations non controversées de la Phase 1, sans action destructrice et sans prétendre qu'une fonctionnalité non intégrée est terminée. Terminer chaque intervention par un résumé des fichiers modifiés, commandes exécutées, résultats des tests, limites et prochaines étapes.

**Objectif final :** une plateforme DuoShopAfrica fiable, élégante, rentable, extensible, exploitable commercialement et techniquement maintenable, avec un circuit de paiement juridiquement validé avant tout lancement réel.
