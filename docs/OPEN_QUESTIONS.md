# Décisions, hypothèses et questions

## Imposé par le cahier / autorisé

Douala d'abord, mobile-first FR/EN/XAF, marque isolée et provisoire, monolithe modulaire recommandé, serveur source de vérité, aucune conservation de fonds présumée, aucune production sans accord. Documents et fondations réversibles demandés par l'utilisateur.

## Propositions structurantes à valider après revue

- Fastify + Next.js + PostgreSQL/Prisma ; un tenant organisation avec plusieurs boutiques et droits par boutique.
- Même origine web/API via reverse proxy, sessions opaques serveur, OIDC externe plutôt qu'un mot de passe développé en interne.
- RLS avec rôle runtime distinct en complément des filtres et FK ; commandes acheteur séparées des sous-commandes vendeur.
- Direction visuelle « Confiance de proximité » et objectifs proposés de performance/SLO/RPO/RTO.
  Décisions consignées en ADR, statut proposé ; leur implémentation de fondations n'est pas une validation métier.

## Bloquant avant auth intégrée

Fournisseur identité (hébergement, coût, email/MFA, exportabilité), politique comptes vendeurs/acheteurs et liaison des emails. Par défaut aucun fournisseur commercial ni compte payant créé.

## Bloquant avant paiement / lancement

PSP et entité contractante habilités, capacité réelle XAF/mobile money, sandbox et signatures ; modèle réglementaire et reversements validés par conseil ; fiscalité/facturation/commission et plan comptable ; responsabilité livraison/retours et délais ; financeur et stratégie paiement des groupes. Marque, domaine et conditions commerciales restent à vérifier. Aucune règle juridique actuelle affirmée dans ces documents.

## Hypothèses non bloquantes

- B09 : réclamation 7 jours après la remise prouvée ; remboursement des articles hors livraison ; arbitrage par un ADMIN plateforme ; dû vendeur gelé pendant le litige ; pas de logistique retour. À inscrire dans les CGV et à valider juridiquement.

- B08 : commission calculée sur les articles hors livraison (la livraison revient au vendeur qui livre), arrondi half-up par sous-commande, figée au paiement et acquise à la remise prouvée ; plan de comptes provisoire (PSP_CLEARING, SELLER_PAYABLE, COMMISSION_DEFERRED, COMMISSION_REVENUE, REFUND_PAYABLE) ; frais PSP et taxes (TVA sur commission) non modélisés. À valider avec l'expert-comptable et le PSP.

- B07 : remise prouvée par un code à 6 chiffres donné par l'acheteur, 5 essais puis blocage (déblocage par le support, procédure à écrire) ; une boutique suspendue ne peut plus faire avancer ses commandes payées (à valider) ; fournisseur SMS/WhatsApp à choisir pour les notifications externes.

- B06 : une tentative de paiement en cours prolonge la réservation de 10 minutes ; une tentative sans réponse est close après 10 minutes (un succès tardif reste enregistré et signalé). Préfixes opérateurs saisis par l'administration, à confirmer avec chaque PSP/opérateur.

- B05 : fenêtre de paiement de 30 minutes avec stock réservé ; frais de livraison fixes par boutique ; adresse acheteur transmise au vendeur seulement après paiement. À valider avec le PSP et les vendeurs pilotes.

- B02 : l'approbation d'une boutique active son organisation (tenant) ; motif obligatoire de 10 caractères ; un refus permet une nouvelle soumission ; la suspension n'a pas encore de levée. À valider par l'équipe conformité.

Une commande mono-devise, plusieurs vendeurs ; retrait boutique ; coordonnées facultatives et repères ; recherche PostgreSQL initiale ; SaaS et B2B après fiabilisation marketplace. Tarifs 5/4 % et 5 000/15 000 XAF non validés, jamais actifs par défaut.

## Registre des risques

- Critique : fuite tenant → B01/RLS/matrice DB/API, responsable technique.
- Critique : fonds et règlements non habilités → gel activation, responsables direction/juridique/PSP.
- Élevé : survente et groupes concurrents → verrous/idempotence/compensation, responsable commerce.
- Élevé : incohérence finance → journal/rapprochement et revue comptable, responsable finance.
- Élevé : prise de compte/pièces privées → MFA, moindre privilège et rétention, responsable sécurité.
- Moyen : faible réseau/adoption marchand → budget web, pilote accompagné, responsable produit.
- Moyen : environnement non reproductible → lockfile/CI/DB réelle, responsable plateforme.
  Les rôles responsables sont à attribuer à des personnes ; aucun interlocuteur réel présumé.
