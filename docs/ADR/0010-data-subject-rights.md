# ADR 0010 — Droits des personnes, consentement et conservation

Date : 2026-11-09. Statut : accepté le 2026-11-10 et livré (lot 2).

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

## Mise en œuvre (10 novembre 2026)

- **Migrations.** `202611190001_compliance_role` ajoute le rôle COMPLIANCE ; PostgreSQL ne retire pas une valeur d'enum, donc le retour arrière la laisse en place. `202611190002_privacy` crée `LegalDocument`, `Consent`, `DataRequest`, `SensitiveAccessLog`, `DataProcessingRegistry` (8 traitements de départ), `User.anonymizedAt` et `Order.cgvVersion`.
- **Documents légaux.**
  - Publication par ADMIN ou COMPLIANCE : version suivante, jamais rétroactive. Le texte est immuable et son empreinte SHA-256 est conservée.
  - Une même version peut exister en français et en anglais ; à défaut de traduction, le français est servi.
  - Le produit ne rédige aucun texte : sans document publié, aucun consentement n'est exigé.
- **Consentements.**
  - En ajout seul, par `record_consent`. Seul le marketing se retire.
  - Contrôle dans `requirePrincipal` : toute modification renvoie 428 `consent_required` tant que les CGU et la politique de confidentialité en vigueur ne sont pas acceptées. Restent exemptés : l'acceptation elle-même, les demandes sur les données, la déconnexion et les routes du personnel (soumis à ses règles internes).
  - Le panier des visiteurs reste ouvert.
  - CGV : la commande exige la version en vigueur (`cgv_acceptance_required`), l'enregistre comme consentement et la fige sur la commande.
- **« Mes données ».** Export JSON et PDF (pdfkit 0.17.2) généré à la demande, sans passer par le worker comme prévu d'abord, car le volume est faible ; préférences commerciales ; demandes avec échéance (`data_request.response_window`, 30 jours, À VALIDER) ; historique des accords.
- **Traitement des demandes.**
  - SUPPORT, ADMIN ou COMPLIANCE prennent en charge et clôturent avec une réponse.
  - Une suppression ne se clôt que par `execute_erasure` (ADMIN ou COMPLIANCE), qui appelle `anonymize_user`. Celle-ci est refusée si une commande, une réclamation ou un remboursement est en cours, ou si la personne a un rôle actif.
  - L'anonymisation efface : e-mail, identité chez le fournisseur, sessions, notifications, panier, codes de remise, coordonnées des adresses et des commandes (quartier et ville gardés), téléphone payeur.
  - Elle conserve : commandes, écritures comptables, réclamations, consentements.
  - **Reste à faire hors application** : supprimer le compte chez Zitadel, procédure d'exploitation à écrire.
- **Conservation.** `apply_retention` traite les notifications, les sessions expirées et les comptes inactifs (anonymisation). Le worker l'exécute une fois par jour, à blanc tant que `retention.mode` ne vaut pas `ENFORCE`. Les durées sont des paramètres de la conformité, à valider (H9).
- **Consultations sensibles.** Le téléphone privé du propriétaire est masqué dans la file de vérification. Il s'affiche sur motif (10 caractères minimum) via `reveal_store_owner`, et chaque affichage est inscrit dans `SensitiveAccessLog`. Ce journal est lisible par ADMIN et COMPLIANCE.
- **Écrans.** Bannière « conditions à accepter » ; pages Conditions, Mes données, textes légaux publics (pied de page) ; case CGV au checkout. Côté personnel : Demandes sur les données, Documents légaux, Journal des consultations, affichage motivé dans Vérifications.
