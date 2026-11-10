# ADR 0015 — Adaptations juridiques dans le produit

Date : 2026-11-09. Statut : proposé (lot 7).

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
