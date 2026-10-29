# PRD initial

## Périmètre

MVP : découverte FR/EN mobile, vendeur approuvé, produit et variantes, stock, panier multi-vendeur, commande et sous-commandes, checkout PSP sandbox confirmé côté serveur, suivi, admin minimal et audit. Phase 3 complète rapprochement, remboursement et livraison. Le MVP ne sort pas tant que les critères financiers et de remboursement ne sont pas démontrés.
V1 : DuoDeals et SaaS payant après validation contractuelle. V2 : B2B complet, publicité, extension pays. Aucun engagement de conservation des fonds ni de délai de paiement vendeur.

## Règles produit

- Le prix final inclut livraison, taxes et frais applicables avant confirmation ; snapshot immuable des règles versionnées.
- Une sous-commande par vendeur ; visibilité de chaque vendeur limitée à sa part, données acheteur minimales pour exécution.
- Stock disponible = stock physique moins réservations actives ; réservation atomique, expiration et compensation idempotentes.
- État commande, état paiement et état livraison sont distincts. Une redirection navigateur ne valide rien.
- Panier invité possible dans le futur ; fusion et consentement à définir. Aucun compte démo actif créé par seed.
- Les devises ne se mélangent pas dans une commande ; conversions affichées seulement si source, date et arrondi définis.
- Suppression de produit par archivage ; données comptables conservées selon politique légalement validée.

## Acceptation du MVP — traçabilité

AC01 Approbation vendeur et audit atomiques : B02, test autorisation et transaction.
AC02 Aucun accès inter-tenant : B01/B02, matrice API, contraintes DB et RLS.
AC03 Publication variantes/prix/photos/stock : B03, tests validation et stockage.
AC04 Recherche → commande → suivi mobile : B04/B05/B07, E2E FR/EN.
AC05 Paiement sandbox uniquement après confirmation serveur : B06, signature/rejeu/ordre inversé.
AC06 Stock non négatif sous concurrence : B03/B05, test DB simultané.
AC07 Commissions déterministes et traçables : B08, arrondis/règles datées/snapshot.
AC08 Remboursement cohérent métier/finance : B09, compensation, journal et rapprochement.
AC09 FR/EN et XAF : B00/B04, parité des traductions et rendu mobile.
AC10 Flux critiques testés et audités : tous les lots, absence d'un test = critère non atteint.
AC11 Démonstrations signalées : bannière, seed isDemo, PSP sandbox distinct et prod désactivée.

## Objectifs non fonctionnels proposés

WCAG 2.2 AA ; LCP p75 ≤ 2,5 s, INP ≤ 200 ms, CLS ≤ 0,1 ; JS initial public ≤ 170 Ko gzip hors images ; API lecture p95 < 400 ms à 50 req/s sur jeu représentatif ; disponibilité pilote 99,5 %, RPO 24 h et RTO 4 h. Mesures et infrastructure nécessaires avant engagement. Décision de coût pour RPO/RTO à valider.
