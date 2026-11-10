# ADR 0013 — KYC vendeur par niveaux

Date : 2026-11-09. Statut : proposé (lot 5).

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
