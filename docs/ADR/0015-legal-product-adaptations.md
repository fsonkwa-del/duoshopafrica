# ADR 0015 — Adaptations juridiques dans le produit

Date : 2026-11-09. Statut : accepté le 2026-11-10 et livré (lot 7).

## Décision

1. **Médiation au lieu d'arbitrage** : renommage dans l'interface FR/EN, la documentation, le domaine (`claim:decide` vers `claim:mediate`) et la base (`arbitrate_claim` vers `mediate_claim`, avec statut et actions d'audit).
   - Les anciens noms d'API restent comme alias pendant un lot. Les anciennes lignes d'audit restent lisibles.
   - Chaque décision de médiation affiche que les parties conservent le droit de saisir la juridiction compétente. Texte fourni par le juriste, versionné (ADR 0010).
2. **Mentions de la loi n° 2010/021 sur le commerce électronique** (liste exacte **À VALIDER PAR JURISTE**, H21) sur chaque fiche boutique, fiche produit et commande : identité du vendeur (raison sociale ou nom, NIU et RCCM selon le niveau KYC), contact, prix TTC, frais de livraison, modalités de réclamation et de médiation. Les mentions sont figées sur la commande au moment de l'achat.
3. **Délai de réclamation** : paramètre `claims.window`, initialisé à 7 jours. Le texte affiché rappelle que ce délai ne remplace pas la garantie légale. Ce texte est fourni par le juriste.
4. **Frais de livraison par zone** :
   - table `DeliveryZone` (quartiers de Douala, gérée par ADMIN) et `StoreZoneFee` (frais par boutique et par zone, avec zones non desservies) ;
   - l'adresse de l'acheteur est rattachée à une zone ; le devis serveur applique le tarif de la zone, puis le fige sur la commande comme aujourd'hui ;
   - les frais fixes actuels deviennent la valeur « toutes zones », pour la compatibilité.

## Conséquences

Lot peu risqué, sans effet sur l'argent déjà encaissé. Les E2E du litige et du checkout sont mis à jour.

## Mise en œuvre (10 novembre 2026)

- **Médiation.**
  - Migration `202611180001_claims_mediation` : `arbitrate_claim` devient `mediate_claim`, et l'ancien nom reste un alias.
  - Permission `claim:mediate`. Nouvelle route `/v1/admin/claims/:id/mediate`, et `/decide` reste comme alias.
  - Textes FR/EN : « médiation », « avis de médiation ».
  - Les clés de notification enregistrées (`claim_arbitrated`) sont conservées pour lire l'historique ; seul leur libellé change.
- **Droits de l'acheteur.** Sur la page de réclamation, un rappel de la garantie légale et du droit de saisir la juridiction compétente (texte provisoire, H26 ; terme « médiation » : H27). L'échéance de réclamation est affichée, calculée avec le paramètre `claims.window` à la date de remise.
- **Mentions légales.**
  - Migration `202611180002_legal_mentions`. Contact public de la boutique (`contactPhone`, `contactEmail`), distinct du téléphone privé du propriétaire.
  - Fonction `store_legal_mentions` : raison sociale, forme, immatriculation, quartier et ville, contact. Elle ne renvoie rien tant que la boutique n'est pas vérifiée et active, et jamais le nom ni le téléphone privés du propriétaire.
  - Mentions affichées sur la fiche produit, et figées sur chaque sous-commande (`SellerOrder.sellerLegal`).
  - Mention « Prix toutes taxes comprises, hors frais de livraison » (H25).
- **Frais par quartier.**
  - Migration `202611180003_delivery_zones` : `DeliveryZone`, avec 15 quartiers de Douala gérés par l'ADMIN ; `StoreZoneFee`, où un montant NULL signifie « non desservi » ; `Address.zoneId`.
  - Le devis serveur applique le tarif du quartier, sinon le tarif « toutes zones » existant, puis le fige sur la commande.
  - Écrans : choix du quartier dans les adresses, tarifs par quartier côté vendeur, page d'administration « Quartiers de livraison ».
  - Les montants « dès » affichés sont le tarif le plus bas.

Non livré dans ce lot :

- les textes définitifs du juriste (CGV, rappel de garantie), que le produit affichera, versionnés, au lot 2 ;
- une page publique de boutique : elle n'existe pas encore, et les mentions sont donc affichées sur chaque fiche produit et chaque commande.
