# ADR 0014 — Reversements aux vendeurs

Date : 2026-11-09. Statut : proposé (lot 6). **Développement conditionné** au choix d'un prestataire agréé en mode `PSP_ESCROW` (ADR 0011). Le mode `DIRECT_SELLER` n'a pas de reversement.

## Décision

1. **Éligibilité** : sous-commandes remises, délai de réclamation écoulé, sans réclamation active ni gel, boutique non suspendue et KYC valide.
2. **Lot hebdomadaire** (paramètres : jour, heure de Douala, seuil minimal 5 000 XAF, plafond par opération, réserve tournante des nouveaux vendeurs exprimée en pourcentage et en durée).
   - FINANCE prépare le lot. Le lot est **figé** : liste des sous-commandes, montants, numéro de destination et empreinte.
   - Un ADMIN distinct le valide, avec MFA.
3. **Exécution unique** : chaque ligne porte une clé d'idempotence transmise au prestataire. Les statuts suivent la même logique de relecture que les paiements : jamais de statut cru sans relecture. Un échec repasse en éligible au lot suivant. Écritures : dû au vendeur vers fonds chez le prestataire.
4. **Numéro de reversement** : modification avec MFA, notification sur l'ancien et le nouveau numéro, puis délai de 72 heures (paramètre) avant usage. Aucun reversement vers un numéro modifié pendant ce délai.
5. **Rapprochement bloquant** : chaque jour, le solde réel lu chez le prestataire (`getBalance`) est comparé au registre. Tout écart au-delà d'une tolérance paramétrée bloque la préparation et l'exécution des lots jusqu'à résolution signée par FINANCE.

## Conséquences

Le lot 6 réutilise le moteur de relecture, le journal et la double validation déjà construits. Rien n'est codé tant que le prestataire et son API ne sont pas connus.
