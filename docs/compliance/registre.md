# Registre des traitements

Version de lecture du registre, dont la source fera foi en base au lot 1 (table `DataProcessingRegistry`, ADR 0009). Les bases légales et les durées sont des hypothèses : **À VALIDER PAR JURISTE** (H5, H9). Lieu de stockage actuel : Hetzner, Allemagne (pré-production uniquement) ; cible : Cameroun.

| Traitement             | Finalité                       | Base légale (hypothèse)             | Données                                                               | Personnes                      | Conservation (paramètre)             |
| ---------------------- | ------------------------------ | ----------------------------------- | --------------------------------------------------------------------- | ------------------------------ | ------------------------------------ |
| Comptes                | Connexion, sécurité            | Contrat                             | E-mail, nom, téléphone, sessions                                      | Acheteurs, vendeurs, personnel | À définir (H9)                       |
| Paniers visiteurs      | Achat sans compte              | Intérêt légitime                    | Empreinte de jeton, articles                                          | Visiteurs                      | `guest_cart.retention` (30 jours)    |
| Commandes et livraison | Exécution de la vente          | Contrat                             | Adresse, téléphone, repère, GPS facultatif                            | Acheteurs                      | À définir (obligation comptable, H9) |
| Paiements              | Encaissement et rapprochement  | Contrat, obligation légale          | Montant, 2 derniers chiffres du numéro payeur, références prestataire | Acheteurs                      | À définir                            |
| Vérification vendeur   | Ouverture de boutique          | Obligation légale (hypothèse)       | Nom légal, propriétaire, téléphone, quartier                          | Vendeurs                       | À définir (lot 5)                    |
| Réclamations           | Service après-vente, médiation | Contrat                             | Motif, description, échanges                                          | Acheteurs, vendeurs            | À définir                            |
| Journal d'audit        | Sécurité, preuve               | Intérêt légitime, obligation légale | Acteur, action, horodatage                                            | Personnel, vendeurs            | À définir                            |
| Journaux techniques    | Exploitation                   | Intérêt légitime                    | Adresse IP, requête sans paramètres                                   | Tous                           | À définir (H9)                       |
