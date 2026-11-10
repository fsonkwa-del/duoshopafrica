# ADR 0012 — Comptabilité SYSCOHADA, frais du prestataire, TVA et factures de commission

Date : 2026-11-09. Statut : accepté le 2026-11-10 et livré (lot 4).

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

## Mise en œuvre (10 novembre 2026)

- **Migration `202611210001_accounting`.** Les fonctions de paiement, de remboursement, de frais et de rapport sont modifiées de façon ciblée ; le `down.sql` restaure leurs corps d'origine.
- **Correspondance SYSCOHADA.** Table `LedgerAccountMapping`, saisie par FINANCE, datée, avec un statut de validation. **Aucune valeur n'est proposée par la plateforme** : les exports affichent « non renseigné » tant que l'expert-comptable n'a rien saisi.
- **Frais du prestataire.**
  - Paramètres `psp.fee_rate.<prestataire>` (Fapshi 3 %, À VALIDER) et `fees.borne_by` (PLATFORM par défaut, réglable par boutique).
  - Journal `psp_fee` par sous-commande en mode plateforme : `PSP_FEES` ou `SELLER_PAYABLE`, contre `PSP_CLEARING`. Pour un paiement à rembourser, les frais sont à la charge de la plateforme. Aucun frais n'est passé en mode direct, où l'argent ne transite pas par la plateforme.
- **TVA.** Hypothèse H13 bis : le taux de commission s'entend TVA comprise, et la TVA en est extraite au taux du jour de la constatation (`vat.commission_rate`, 19,25 %, À VALIDER). Le net vendeur et les contrôles existants sont donc inchangés. Une reprise sur remboursement reprend la TVA dans la même proportion.
- **Constatation.** `commission.recognition` est figé sur la sous-commande au paiement.
  - `HANDOVER` (défaut, comportement d'origine) : la commission est constatée à la remise.
  - `CLAIM_WINDOW_END` : le worker la constate après le délai de réclamation, s'il n'y a aucune réclamation active. Une reprise faite avant porte sur la commission différée.
- **Factures et avoirs.**
  - Séries FC et AV, numérotation sans trou par exercice (compteur verrouillé dans la transaction).
  - Une pièce par boutique et par mois, émise par le worker et rejouable : rien n'est facturé deux fois (index uniques partiels).
  - Mentions du vendeur et de la plateforme figées sur la pièce ; PDF bilingue généré à la demande.
  - Paiement constaté par FINANCE avec une référence.
  - **L'émission est bloquée tant que la raison sociale et le NIU de la plateforme ne sont pas saisis** (`platform.legal_name`, `platform.niu`) : aucune identité n'est inventée.
- **Exports CSV.** Grand livre, balance, journal de TVA, factures (BOM UTF-8, point-virgule, montants entiers), réservés à FINANCE et tracés dans `ConfigAudit`.
- **Rapport financier corrigé.** Les paiements du mode direct (lot 3) n'y apparaissaient pas encore et auraient été signalés à tort comme non comptabilisés. Le rapport ajoute aussi les créances de commission par vendeur et les factures échues impayées.
- **Non fait.**
  - Suspension automatique d'un vendeur qui ne paie pas sa commission : seulement signalée dans le rapport (H34).
  - Déclarations fiscales.
