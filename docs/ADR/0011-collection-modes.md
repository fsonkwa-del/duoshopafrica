# ADR 0011 — Modes d'encaissement sans détention de fonds de tiers

Date : 2026-11-09. Statut : accepté le 2026-11-10, livré pour la partie logicielle (lot 3). Précède toute mise en production avec de l'argent réel.

## Contexte

Aujourd'hui, l'acheteur paie sur le compte Fapshi de la plateforme, qui enregistre ensuite un dû envers le vendeur. La plateforme détient donc l'argent de tiers. Selon notre hypothèse H10 (**À VALIDER PAR JURISTE**), cette activité relève des services de paiement encadrés par le règlement n° 04/18/CEMAC/UMAC/COBAC, et elle exigerait un agrément ou le recours à un établissement agréé. Fapshi exclut en outre les agrégateurs de paiement.

## Décision

1. **Deux modes, choisis par environnement et figés sur chaque paiement** (`collectionMode` sur `Payment`) :
   - **`DIRECT_SELLER`** (pilote). Chaque boutique a son propre compte marchand chez le prestataire. Ses identifiants sont stockés chiffrés par enveloppe dans `StorePaymentAccount`, jamais lisibles par le runtime en clair hors de l'adaptateur. La plateforme initie le paiement avec les identifiants de la boutique et relit le statut avec eux. L'argent arrive directement chez le vendeur.
     - Écritures comptables dédiées : la vente est constatée hors du bilan de la plateforme, qui inscrit une **créance de commission** sur le vendeur (lot 4).
     - Recouvrement de la commission : facture périodique (lot 4), puis paiement par le vendeur vers le compte de la plateforme. Ce sont alors les propres revenus de la plateforme, pas des fonds de tiers. En cas d'impayé au-delà d'un délai paramétré, la publication de la boutique est suspendue automatiquement.
     - Conséquence pour l'acheteur : la plateforme ne peut plus geler le dû pendant une réclamation, et le remboursement est exécuté par le vendeur. La médiation (lot 7) reste, mais sa force repose sur la suspension de la boutique. Ce recul doit figurer dans les CGV.
   - **`PSP_ESCROW`** (cible). Un établissement agréé détient les fonds, répartit les montants, reverse et rembourse via son API. Le registre actuel « dû au vendeur » reste valable, comme miroir du solde chez le prestataire.
   - **`PLATFORM_HELD`** : le mode actuel. Interdit en production, sauf déverrouillage décrit au point 3.
2. **Capacités des adaptateurs** : `PaymentProvider` déclare `capabilities` (`collect`, `ussdPush`, `refund`, `payout`, `balance`, `split`, `perMerchantCredentials`) et gagne des méthodes optionnelles `refund`, `payout`, `getBalance` et `splitPayment`. Au démarrage, l'API refuse un mode qui exige une capacité absente : `PSP_ESCROW` exige `split`, `payout`, `refund` et `balance` ; `DIRECT_SELLER` exige `perMerchantCredentials`. Les adaptateurs Fapshi et CinetPay déclarent leurs capacités d'après leur documentation, sans rien supposer.
3. **Verrou du mode détenteur** : `PLATFORM_HELD` en production exige une ligne `CollectionModeAuthorization` approuvée par deux membres distincts (ADMIN puis FINANCE, MFA), avec une référence d'agrément et une date d'expiration. Sans ligne valide, l'API et le worker refusent de démarrer. Cette autorisation est vérifiée en base, car un simple drapeau d'environnement ne prouve rien.
4. **Push USSD** : si l'adaptateur déclare `ussdPush`, l'acheteur saisit son numéro et un écran « Confirmez sur votre téléphone » rafraîchit le statut côté serveur, sans JavaScript obligatoire. Sinon, la page hébergée actuelle est conservée. La durée de réservation pendant la tentative passe par le paramètre `payment.attempt_window`, initialisé à 15 minutes. Fapshi propose bien un paiement direct, mais sa documentation l'interdit aux agrégateurs : à demander (P4).
5. **Succès tardif** : dans `apply_payment_event`, si la commande a expiré, on tente de reprendre le stock par la même mise à jour conditionnelle que `reserve_public_stock`, dans la même transaction, au prix figé de la commande.
   - Si le stock est disponible : la commande est confirmée, avec une écriture normale et une notification « commande confirmée après délai ».
   - Sinon : le comportement actuel est conservé (paiement à traiter et remboursement).
   - Le comportement est activable par un paramètre et ne s'applique pas à une commande annulée par l'acheteur.

## Conséquences

- Le mode direct supprime la détention de fonds, mais transfère au vendeur le risque de remboursement et à la plateforme un risque de recouvrement de commission.
- Les tests actuels de paiement restent valables en `PLATFORM_HELD` (développement, tests). Une suite parallèle couvre `DIRECT_SELLER`.
- Le lot 6 (reversements) n'a de sens qu'en `PSP_ESCROW`.

## Mise en œuvre (10 novembre 2026)

- **Migrations.**
  - `202611200001_collection_enums` : type `CollectionMode` ; comptes `COMMISSION_RECEIVABLE`, `PSP_FEES` et `VAT_COLLECTED` (ces deux derniers pour le lot 4) ; statut de remboursement `SELLER_TO_EXECUTE`.
  - `202611200002_collection_modes` : mode et compte marchand figés sur `Payment`, `StorePaymentAccount`, `CollectionModeAuthorization`. Les fonctions de paiement, de journal et de remboursement sont modifiées de façon ciblée, et le `down.sql` restaure leurs corps d'origine.
- **Configuration.**
  - `COLLECTION_MODE` est obligatoire en production.
  - Le mode direct exige `PAYMENT_ACCOUNTS_KEY_<n>` (32 octets) et `PAYMENT_ACCOUNTS_KEY_VERSION`.
  - Au démarrage, l'API refuse un mode dont les capacités manquent ; le séquestre est donc refusé aujourd'hui, faute d'adaptateur avec `split`, `payout`, `refund` et `balance`.
  - Avec de l'argent réel (`NODE_ENV=production` et un prestataire de la plateforme en LIVE), l'API refuse aussi `PLATFORM_HELD` sans autorisation approuvée et non expirée. La pré-production en sandbox n'est pas concernée.
- **Mode direct.**
  - Le propriétaire de la boutique (permission `payments:configure`) saisit ses identifiants. Ils sont chiffrés en AES-256-GCM avec une clé versionnée hors base et ne sont jamais renvoyés. Chaque compte a sa propre adresse de notification.
  - Une commande ne regroupe qu'un vendeur (`one_seller_per_order`) : le reste du panier est conservé.
  - L'acheteur paie le compte du vendeur. Une notification ou une relecture ne vaut que pour les paiements de ce compte : sinon l'événement est mis en quarantaine (`account_mismatch`). C'est la parade à un vendeur qui créerait chez lui une transaction portant l'identifiant de paiement d'un autre.
  - **Journal.** Le paiement constate `COMMISSION_RECEIVABLE` (par vendeur) contre `COMMISSION_DEFERRED`, sans fonds chez le prestataire ni dette envers le vendeur.
  - **Remboursement décidé.** Il passe en `SELLER_TO_EXECUTE`, et seule la commission reprise touche la créance.
  - Le worker relit les paiements en attente avec les identifiants de chaque compte.
- **Autorisation `PLATFORM_HELD`.** Demande par un ADMIN (référence d'agrément, date de fin), approbation par une autre personne FINANCE, révocation possible, chaque étape auditée.
- **Push USSD.** L'écran « Confirmez sur votre téléphone » (rechargement automatique, sans JavaScript) est prêt. **Aucun adaptateur ne déclare `ussdPush`** : le paiement direct Fapshi est refusé aux agrégateurs (question P4). La durée d'une tentative passe à 15 minutes (nouvelle période du paramètre `payment.attempt_window`).
- **Succès tardif.** Si la commande a expiré mais que le stock est encore disponible au même emplacement et l'article toujours en vente, la commande est confirmée automatiquement (`late_confirmed`). Sinon, le comportement d'avant est conservé : signalement et remboursement manuel. Le paramètre `payment.late_success_autoconfirm` (`true` par défaut) contrôle ce comportement ; une commande annulée par l'acheteur n'est jamais confirmée.
- **Non fait.**
  - Le recouvrement de la commission (factures et suspension en cas d'impayé) relève du lot 4.
  - Accord de Fapshi pour des comptes par vendeur : questions P1 à P3.
