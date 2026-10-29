# Réalisation par phases

Pas de dates promises sans équipe, budget et validations. Chaque incrément vertical comporte schéma+migration, API, UI, habilitations, tests et documentation. Le socle actuel est l'exception préparatoire explicitement autorisée par le cahier.

0. Audit/conception : dossier complet, personas, benchmark heuristique, parcours, ERD, architecture, ADR, risques/backlog et wireframes. Sortie : revue et validation des choix structurants, questions de lancement attribuées. État : dossier préparé, validation utilisateur attendue.
1. Fondations : B00/B01 ; sortie workspace/CI verts, migration+seed rejouables, auth sessions/MFA et isolation API/DB vérifiées, i18n et composants accessibles, observabilité minimale. État : socle préparé ; RLS, rôle runtime, sessions et isolation lecture prouvées (Sprint 1, voir VALIDATION) ; OIDC Zitadel et attestation MFA vérifiés contre un Zitadel réel (Sprint 2) ; E2E navigateur, Login V2 et application de la MFA aux rôles admin encore requis.
2. Marketplace (B02 livré hors pièces KYC, Sprint 3 ; B03 livré, photos au Sprint 5 ; B04 livré, Sprint 5 ; B05 livré sans paiement, Sprint 6 ; B06 fondation paramétrable livrée, PSP réel en attente, Sprint 7 ; panier visiteur, Sprint 7 bis ; B07 livré hors SMS, Sprint 8) : B02–B06 plus suivi/admin minimal ; sortie vendeur approuvé publie, acheteur commande mobile et confirmation sandbox vérifiée, stock concurrent fiable. Ne pas appeler MVP commercial complet avant B07–B10.
3. Paiements/livraison : B07–B10 ; sortie rapprochement/remboursement/factures/commissions et règles de règlement validés et testés, revue juridique et contrat PSP. Aucun paiement réel sans approbation.
4. DuoDeals : B11 ; sortie machine à états/concurrence/expiration/compensation, remise et stratégie PSP approuvées.
5. SaaS/croissance : B12–B15 par sous-lots ; sortie quotas/domaine/abonnement et pays réellement testés, aucun prix commercial hypothétique activé.
6. Industrialisation : sécurité/charge/restauration, pilote Douala accompagné, KPI et support/PRA-PCA ; sortie go/no-go explicite, déploiement progressif surveillé et budget approuvé.

## Premier incrément concret (Sprint 1 — livré, sauf identité)

Brancher identité choisie et livrer « membre autorisé consulte sa boutique ». Étendre migration RLS et rôle runtime, API GET /v1/stores/:id, UI FR/EN du compte, sessions révoquées/MFA plateforme, audit d'accès sensible, tests A/B/absence contexte. Aucun catalogue ni paiement à construire avant avoir démontré l'isolation. Dépendance : validation de l'architecture et choix d'identité.
