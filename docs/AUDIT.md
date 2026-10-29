# Audit factuel initial

Date : 2026-10-28, Africa/Douala. Inspection avant modification.

## Dépôt

- Deux fichiers visibles hors .git : PROMPT_CODEX_DUOSHOPAFRICA.md (16 409 octets), .vscode/extensions.json.
- Aucun package.json, application, migration, test, CI, secret applicatif ou convention AGENTS.md trouvé dans le dépôt et ses parents D:/ et D:/PROJETS/.
- Aucun historique de code à préserver : Git indique une branche master sans commit.
- Git refuse initialement la propriété du dépôt (propriétaire CodexSandboxOffline, utilisateur ferna), puis indique « must be run in a work tree » avec exception ponctuelle. Aucun réglage global ni contenu .git modifié.
- Les fichiers existants sont conservés. Aucune disponibilité du nom commercial ni des domaines vérifiée.

## Environnement

- PowerShell, Windows ; Node 26.2.0, npm 11.13.0, pnpm 9.12.3 observés.
- docker.exe présent ; daemon indisponible (pipe dockerDesktopLinuxEngine absent).
- Node 24 LTS proposé pour CI et exécution cible, Node 26 local à distinguer des vérifications sous LTS.
- Répertoire cible hors des racines initiales d'écriture : autorisation système requise pour y créer les fichiers et installer les dépendances.
- Versions et compatibilité : voir ADR/0002-toolchain.md et le lockfile ; la consultation npm ne prouve pas l'absence de vulnérabilités.

## Conséquences

Créer un socle neuf sans générateur destructif. Tester le code localement ; ne pas annoncer de test DB, conteneur, navigateur, CI distante ou PSP sans résultat effectivement obtenu. La réparation Git reste une opération distincte.
