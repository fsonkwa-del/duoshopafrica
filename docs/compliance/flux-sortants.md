# Flux sortants

Inventaire des services hors de nos machines qui reçoivent des données de la plateforme. La CI (`node scripts/check-outbound-hosts.mjs`) échoue si un hôte externe apparaît dans le code ou la configuration sans figurer dans la première colonne de ce tableau.

Objectif (ADR 0009) : aucune donnée personnelle hors du Cameroun, sous réserve de l'hypothèse H2 (À VALIDER PAR JURISTE). Mise à jour : 10 novembre 2026.

| Hôte                                    | Service                                                | Données transmises                                                               | Pays                                                       | Données personnelles                                                      | État             |
| --------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------- |
| `sandbox.fapshi.com`, `live.fapshi.com` | Fapshi, encaissement Mobile Money                      | Montant, identifiant de paiement interne, libellé de commande, adresse de retour | Cameroun (siège) ; hébergement des données à demander (P6) | Aucune envoyée par l'API. L'acheteur saisit son numéro sur la page Fapshi | Actif en sandbox |
| `api-checkout.cinetpay.com`             | CinetPay, encaissement (adaptateur écrit, non utilisé) | Montant, identifiant de paiement, libellé, adresses de retour                    | Côte d'Ivoire (siège)                                      | Aucune envoyée                                                            | Inactif          |
| `acme-v02.api.letsencrypt.org`          | Let's Encrypt, certificats TLS (Caddy, implicite)      | Noms de domaine                                                                  | États-Unis                                                 | Aucune                                                                    | Actif            |

## Flux implicites hors code

| Flux                                      | Données                                                                                     | Pays          | État                                              |
| ----------------------------------------- | ------------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------- |
| Hébergement actuel (Hetzner, Falkenstein) | Toutes les données, y compris personnelles (comptes de test, e-mails, téléphones, adresses) | Allemagne     | **Non conforme à l'objectif.** Migration au lot 1 |
| Images Docker (Docker Hub, GitHub)        | Aucune ; téléchargement d'images publiques                                                  | International | Actif                                             |
| GitHub (code, CI)                         | Code source, aucune donnée de production                                                    | États-Unis    | Actif                                             |

## Flux prévus, non activés

| Flux                                   | Données                                                  | Décision                                                                                                         |
| -------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| SMS (agrégateur camerounais à choisir) | Numéro, message sans contenu de commande                 | Lot 8                                                                                                            |
| E-mail transactionnel                  | Adresse e-mail, événement, référence et lien de commande | Adaptateur SMTP livré (lot 8), inactif tant qu'aucun serveur n'est choisi ; déclarer l'hôte ici avant activation |
| WhatsApp Business (Meta)               | Numéro, message                                          | Désactivé par défaut (hypothèse H4)                                                                              |
| CDN                                    | Adresse IP des visiteurs                                 | Cache locale au Cameroun par défaut (hypothèse H4)                                                               |
