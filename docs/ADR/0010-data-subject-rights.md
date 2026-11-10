# ADR 0010 — Droits des personnes, consentement et conservation

Date : 2026-11-09. Statut : proposé (lot 2).

## Contexte

Aucun consentement n'est enregistré aujourd'hui. Il n'existe ni export, ni demande de suppression, ni politique de conservation, ni trace des consultations du personnel, hormis les décisions auditées. Les obligations exactes de la loi n° 2024/017 (droits, délais de réponse, bases légales) sont **À VALIDER PAR JURISTE** (H5 à H8).

## Décision

1. **Documents légaux versionnés** : table `LegalDocument` (type : CGU, CGV, confidentialité ou marketing ; version ; langue ; empreinte SHA-256 du texte ; date d'effet). Les textes viennent du juriste ; le produit ne rédige rien.
2. **Consentements en ajout seul** : table `Consent` (utilisateur, document et version, accordé ou retiré, horodatage, origine). Aucune modification ni suppression par le runtime : un retrait est une nouvelle ligne. L'état courant est la dernière ligne par document.
   - Les CGU et la politique de confidentialité sont acceptées à l'inscription, puis à nouveau à chaque nouvelle version, avant toute autre action. Les CGV sont acceptées au passage de commande, et leur version est figée sur la commande.
   - Le marketing est facultatif, décoché par défaut, et retirable à tout moment.
3. **Espace « Mes données »** :
   - export JSON et PDF bilingue, généré par le worker et disponible 7 jours (paramètre) par lien à usage unique ;
   - rectification des champs modifiables, ou demande au SUPPORT pour les autres ;
   - demande de suppression : `DataRequest` (type, statut, échéance calculée avec le délai paramétré, agent, motif), file de traitement pour le SUPPORT, alerte avant l'échéance.

   La suppression devient une anonymisation quand une obligation de conservation s'applique : commandes, journal comptable, factures et KYC sont gardés pour leur durée légale avec l'identité remplacée.
4. **Conservation appliquée par le worker** : pour chaque entrée du registre (ADR 0009), une règle de purge ou d'anonymisation. Exécution quotidienne, d'abord à blanc et journalisée. Ne touche jamais une table comptable, ni un dossier en litige, sous gel ou sous enquête.
5. **Journal de consultation** : `SensitiveAccessLog` en ajout seul (agent, ressource, motif obligatoire, horodatage). Chaque lecture par le personnel d'une pièce KYC, d'un contact d'acheteur ou d'un export y est enregistrée par la fonction SQL qui fournit la donnée. Lecture du journal réservée à ADMIN et COMPLIANCE.

## Conséquences

- Un rôle plateforme COMPLIANCE est ajouté, utilisé aussi par le lot 5.
- Les pages d'inscription et de commande reçoivent une étape d'acceptation, avec mise à jour des E2E.
- Les données des comptes de test existants n'ont aucun consentement : elles seront purgées avant tout lancement réel.
