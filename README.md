# DuoShopAfrica

Socle local en construction. Aucun paiement, compte marchand ni règlement vendeur réel.
Le cahier initial reste intact dans PROMPT_CODEX_DUOSHOPAFRICA.md.

Commencer par [le dossier de conception](docs/INDEX.md), [l'audit](docs/AUDIT.md)
et [le rapport de validation](docs/VALIDATION.md).

## Développement

Node 24 LTS recommandé (voir .nvmrc), pnpm 12.15.0.

1. `corepack enable`, puis `corepack prepare pnpm@12.15.0 --activate` si Corepack est installé ; sinon `npx --yes pnpm@12.15.0 <commande>`.
2. `pnpm install --frozen-lockfile`.
3. Copier .env.example vers .env et choisir un mot de passe PostgreSQL local.
4. `docker compose up -d` (moteur Docker requis).
5. `pnpm db:generate`, `pnpm db:deploy`, puis `pnpm db:seed`.
6. `pnpm dev` ; web http://localhost:3000/fr ; API http://localhost:4000/health/live.

`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` forment les contrôles locaux.
`pnpm test:db` nécessite une base locale migrée et vérifie les contraintes d'isolation.
`pnpm build && pnpm test:e2e` exécute les parcours Playwright (mobile et bureau, accessibilité axe) sur les builds de production ; voir docs/OPERATIONS.md.
Identité : Zitadel via OIDC (ADR 0005, runbook local dans OPERATIONS.md), configuré par `OIDC_ISSUER` et `OIDC_CLIENT_ID`. Sans Zitadel, `pnpm dev:session nom@example.invalid` émet une session DEV sur la boutique DEMO avec un lien /dev-login (désactivé en production).
Les tests unitaires ne prouvent pas l'isolation d'une future API : voir TEST_PLAN.md.
