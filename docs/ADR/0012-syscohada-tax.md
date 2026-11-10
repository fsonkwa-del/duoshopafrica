# ADR 0012 — Comptabilité SYSCOHADA, frais du prestataire, TVA et factures de commission

Date : 2026-11-09. Statut : proposé (lot 4).

## Contexte

Le journal interne utilise 5 comptes provisoires (PSP_CLEARING, SELLER_PAYABLE, COMMISSION_DEFERRED, COMMISSION_REVENUE, REFUND_PAYABLE). Il n'enregistre ni frais du prestataire, ni TVA, ni facture. Le taux de 19,25 % et les numéros de comptes SYSCOHADA ci-dessous sont des hypothèses **À VALIDER PAR EXPERT-COMPTABLE** (H12 à H16).

## Décision

1. **Correspondance SYSCOHADA** : table `LedgerAccountMapping` (compte interne, numéro et libellé SYSCOHADA, dates d'effet). Elle est remplie par l'expert-comptable via l'administration. La migration ne propose que des valeurs marquées `A_VALIDER`. Les comptes internes ne changent pas, ce qui préserve le journal existant.
2. **Nouveaux comptes internes** : `PSP_FEES` (charge), `VAT_COLLECTED`, `COMMISSION_RECEIVABLE` (créance sur vendeur en mode direct) et `SELLER_FEE_RECHARGE`.
3. **Frais du prestataire** : paramètre `psp.fee_rate` par prestataire et par date, initialisé à 3 % (Fapshi, d'après sa documentation). Ils sont enregistrés à l'encaissement. Le paramètre `fees.borne_by` (`PLATFORM` ou `SELLER`), par contrat vendeur, décide s'ils sont refacturés. Le rapprochement compare ensuite au relevé réel du prestataire, et un écart devient un écart à traiter.
4. **TVA sur commission** : paramètre `vat.commission_rate`, initialisé à 19,25 % et marqué `A_VALIDER`. Elle est calculée sur la commission seule, en franc entier avec arrondi half-up par facture. Écritures dédiées vers `VAT_COLLECTED`.
5. **Factures de commission** :
   - une facture par vendeur et par période (mensuelle par défaut, paramètre) ;
   - numérotation sans trou par série et par exercice, avec un compteur verrouillé dans la même transaction que la facture ;
   - facture émise immuable, correction uniquement par avoir ;
   - PDF bilingue FR/EN généré par le worker, avec raison sociale, NIU de la plateforme et du vendeur s'ils sont connus, détail des sous-commandes, montant HT, TVA et TTC.

   En mode direct, la facture constate la créance ; en mode séquestre, la commission est retenue à la source.
6. **Acquisition de la commission** : paramètre `commission.recognition`, qui vaut `HANDOVER` (comportement actuel) ou `CLAIM_WINDOW_END`. Dans le second cas, le worker constate l'acquisition à la fin du délai de réclamation, sans réclamation ouverte. Le paramètre est figé sur la sous-commande au paiement : jamais de requalification rétroactive.
7. **Exports** pour l'expert-comptable : grand livre, balance, journal de TVA et factures, en CSV UTF-8 avec BOM, séparateur point-virgule et montants entiers (format lisible par Excel en français). Réservés à FINANCE, chaque export étant audité.

## Conséquences

- La contrainte d'équilibre différée reste la garantie centrale ; chaque nouvelle écriture est testée avec elle sous PostgreSQL 17.
- Le rapport Finance gagne la TVA collectée, les frais et les créances vendeurs.
