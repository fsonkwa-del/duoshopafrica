# ADR 0003 — Argent et paiements

Date : 2026-10-28. Statut : garde-fous imposés ; modalités PSP proposées.

Décision : BigInt unités mineures + devise, chaînes JSON, pas de float ; commissions en points de base avec arrondi half-up proposé et snapshot versionné. État financier déclenché par preuve PSP serveur authentifiée/idempotente, journal en partie double et outbox transactionnelle. Aucun séquestre interne, aucun fournisseur présumé compatible. Fonctions provider exposées selon contrat et pays.
Alternatives écartées : confirmer par retour navigateur, conserver fonds via compte personnel, succès mock en production, montants flottants ou simple champ balance comme comptabilité.
Conséquences : sandbox et partenaire/juridique bloquent l'activation ; remboursements et reversements sont des opérations asynchrones rapprochées. La fonction commission du socle est testée comme simulation, pas comme tarification active.
