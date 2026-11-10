# ADR 0013 — KYC vendeur par niveaux

Date : 2026-11-09. Statut : accepté le 2026-11-10 et livré (lot 5).

## Contexte

La vérification actuelle est déclarative : nom légal, propriétaire, téléphone, quartier, sans aucune pièce. En mode direct (ADR 0011), le vendeur encaisse lui-même : connaître son identité et plafonner son activité limite la fraude. Les pièces exigées, les plafonds et la durée de conservation sont **À VALIDER PAR JURISTE** (H17 à H20).

## Décision

1. **Niveaux paramétrables** : table `KycTierRequirement` (niveau, type de pièce, obligatoire, dates d'effet). Valeurs initiales :
   - **niveau 1** (activité informelle) : CNI ou passeport, photo du visage, numéro Mobile Money, localisation ;
   - **niveau 2** : niveau 1, plus NIU et RCCM ou récépissé ;
   - **niveau 3** (société) : niveau 2, plus statuts, attestation de conformité fiscale et CNI du dirigeant.

   Le « numéro Mobile Money au même nom » se vérifie manuellement par l'agent : aucune API de vérification de titulaire n'est supposée disponible (question P5).
2. **Pas de biométrie automatisée** : la photo du visage est comparée à la pièce par un agent humain. Aucun gabarit biométrique n'est calculé ni stocké. Ce choix est proposé pour éviter le régime des données sensibles ; une vérification automatique viendrait seulement après validation.
3. **Stockage séparé et chiffré** :
   - bucket `duoshop-kyc` distinct, sans lecture publique, avec ses propres identifiants S3 que seul le worker KYC possède ;
   - chiffrement par enveloppe côté application (AES-256-GCM), une clé par pièce, chiffrée par une clé maîtresse KYC distincte, versionnée et rotative ;
   - envoi direct présigné vers une quarantaine KYC, contrôle du type réel et analyse antivirus (lot 8), puis chiffrement et déplacement ;
   - consultation par une URL de courte durée générée après une écriture au journal de consultation (ADR 0010), réservée à ADMIN et COMPLIANCE, avec MFA ;
   - conservation par le paramètre `kyc.retention`, initialisé à 10 ans après la fin de la relation (`A_VALIDER`), puis purge de l'objet et anonymisation de la fiche.
4. **Double validation** : la personne qui saisit ou complète un dossier pour un vendeur ne peut pas le valider (contrôle en base, comme la règle actuelle « pas de décision sur sa propre boutique »). Motif obligatoire en cas de refus. Chaque décision est versionnée et auditée.
5. **Plafonds de ventes mensuels** : paramètre `kyc.monthly_cap` par niveau. Un compteur `StoreMonthlySales` est mis à jour dans la fonction SQL qui confirme un paiement, avec verrou de ligne.
   - Le passage de commande est refusé si le total dépasserait le plafond ; la confirmation d'un paiement au-delà est mise à traiter.
   - Le mois est calculé à l'heure de Douala.

## Conséquences

- Les boutiques existantes passent au niveau 0 : elles peuvent préparer leur catalogue, mais pas vendre en argent réel.
- Le traitement des pièces ajoute du stockage chiffré et un service de clés à exploiter, sauvegardés séparément.

## Mise en œuvre (10 novembre 2026)

- **Migration `202611220001_kyc`.** `KycTierRequirement` (exigences cumulatives, alternatives CNI ou passeport), `KycProfile`, `KycDocument`, paramètres et fonctions.
- **Coffre.** `PrivateVault` (S3 ou mémoire), identifiants `KYC_S3_*` distincts de ceux des photos (refus au démarrage s'ils sont identiques), clé maîtresse `KYC_MASTER_KEY_<n>` versionnée.
  - Chaque pièce passe par l'API, qui contrôle son type réel sur les premiers octets (JPEG, PNG ou PDF, 5 Mo au plus) et peut l'analyser par antivirus (lot 8).
  - Elle est ensuite chiffrée par enveloppe : une clé de données par pièce, chiffrée par la clé maîtresse. Seule la clé de données chiffrée est en base. Fonction `rewrapKey` pour la rotation.
  - La pièce n'est jamais stockée en clair, pas même en quarantaine.
- **Dossier.** Le propriétaire (permission `kyc:manage`) dépose les pièces puis le dossier : niveau, numéro Mobile Money, localisation, NIU à partir du niveau 2. `submit_kyc` refuse s'il manque une pièce.
- **Décision.**
  - `review_kyc` revient à ADMIN ou COMPLIANCE, jamais à la personne qui a déposé le dossier ou une pièce. Un refus exige un motif ; chaque décision est auditée.
  - La vérification que le numéro Mobile Money est au même nom reste manuelle (question P5).
- **Consultation.** `reveal_kyc_document` exige un motif et inscrit la consultation dans `SensitiveAccessLog`. L'API renvoie la pièce déchiffrée sans cache, ouverte par un formulaire POST : jamais dans une URL.
- **Conservation.** Une pièce remplacée reçoit une date d'effacement (`kyc.retention`, 10 ans, À VALIDER) ; le worker efface ensuite l'objet du coffre et la clé.
  - **Reste à définir** : la « fin de la relation » qui déclenche l'effacement des pièces en vigueur (fermeture de boutique, à concevoir).
- **Plafonds.** `kyc.monthly_cap.tier0..3` (0, 1, 10 et 100 millions de FCFA, valeurs provisoires H20) sont appliqués à la commande, sous verrou par boutique, en comptant les ventes payées et en attente du mois (heure de Douala).
  - **Désactivés par défaut** (`kyc.enforce_caps = false`) tant que les montants ne sont pas fixés : à activer avant le passage en LIVE.
- **Écrans.** Section « Vérification d'identité (KYC) » de la boutique ; page d'administration « Dossiers KYC ».
