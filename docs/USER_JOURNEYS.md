# Parcours et états

## Acheteur

Accueil langue choisie → recherche/filtres → produit (variantes, disponibilité, vendeur, prix livré estimé) → individuel ou groupé explicitement conditionnel → panier ventilé par vendeur → adresse/repère/retrait → frais complets et consentement → initiation PSP → attente de vérification serveur → suivi par sous-commande → livraison → réclamation/retour. Réseau interrompu : conserver panier, réessayer avec même clé d'idempotence, afficher état serveur ; ne pas déduire un succès d'un écran PSP.
Échecs : variante épuisée, prix modifié avec reconfirmation, zone non desservie, paiement en attente/échoué, expédition partielle, livraison échouée, litige. Remboursement peut rester en attente PSP et ne devient réussi qu'après preuve fournisseur.

## Groupe (Phase 4)

Lire seuil/durée/prix individuel et groupé → créer/rejoindre → réserver stock et vérifier place dans transaction → partager lien sans PII → attendre seuil → confirmer selon capacités PSP validées → exécuter commande. Expiration/annulation : libérer réservations et annuler autorisation ou rembourser selon stratégie contractuelle. Pas d'encaissement groupé activé avant décision PSP. Machine proposée DRAFT → OPEN → FORMED → COMPLETED ; OPEN → EXPIRED/CANCELLED ; traitement compensatoire séparé, transitions gardées et idempotentes.

## Marchand

Créer compte → vérification email/MFA selon rôle → demander boutique → fournir pièces selon besoin minimal → suivi décision → approbation avec audit → créer produit/variantes → prix/photos/stock → soumettre publication → recevoir commande payée vérifiée → préparer/expédier → consulter revenus acquis, remboursements et montants dus distincts. Suspension bloque nouvelles ventes et accès sensible sans effacer obligations existantes.

## Administration/support

MFA → rôle/scopes → file d'approbation → décision motivée/audit → modération. Support consulte chronologie et ouvre litige ; finance seule instruit un remboursement autorisé ; approbation renforcée selon seuil configurable et séparation demandeur/approbateur. Conformité gère vérification ; sécurité gère habilitations ; accès exceptionnel tracé et à durée limitée.

## Machines transactionnelles proposées

Order : DRAFT → AWAITING_PAYMENT → CONFIRMED → FULFILLING → COMPLETED ; cancellation et retours encadrés par quantités.
PaymentIntent : CREATED → PENDING → SUCCEEDED/FAILED/CANCELLED ; remboursement et chargeback comme opérations distinctes, pas effacement du paiement réussi.
Shipment : READY → DISPATCHED → DELIVERED ou FAILED → RETURNING → RETURNED.
Toutes transitions sensibles : état attendu/version + autorisation + événement audit/outbox dans transaction. Un événement tardif déclenche lecture état PSP et rapprochement, pas régression aveugle.
