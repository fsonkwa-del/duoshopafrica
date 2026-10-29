# ADR 0002 — Versions et reproductibilité

Date : 2026-10-28. Statut : proposé, versions exactes verrouillées après installation.

Registre npm consulté lors de l'exécution : Next 16.4.3, React 19.3.1, Fastify 5.12.7, Prisma 7.10.1 (branche stable 7), TypeScript latest 7.0.2, Turbo 2.11.10, pnpm 12.15.0, Vitest 5.0.5, Biome 2.6.3. TypeScript 5.9.3 retenu conservativement pour Prisma 7 et intégration Next ; ne pas migrer de majeure simultanément au bootstrap. Node local 26.2.0 ; cible Node 24 LTS, compatible avec la matrice Prisma 7. pnpm existant 9 remplacé pour ce dépôt par packageManager explicite, sans modification globale.
Prisma 8 est indiqué release candidate dans la documentation consultée : différé. Prisma 7 nécessite ESM, generator avec output et adapter PostgreSQL. Le lockfile est la référence exacte transitive ; pas de latest dans manifests.
Sources primaires :
- https://nextjs.org/docs/app/getting-started/installation
- https://www.prisma.io/docs/orm/v7/reference/system-requirements
- https://www.prisma.io/docs/orm/v7
- https://www.prisma.io/docs/orm/supported-versions
- https://github.com/fastify/fastify/blob/main/docs/Reference/LTS.md
- https://registry.npmjs.org/ (métadonnées via npm view)

Les images Compose sont locales et versionnées ; validation digest, patchs et scan vulnérabilités requis avant staging. Compatibilité déclarée n'est pas preuve d'exécution sous Node 24 : voir VALIDATION.

Installation : pnpm 12 utilise allowBuilds (les anciens onlyBuiltDependencies sont ignorés). Seuls @prisma/engines, prisma et esbuild sont autorisés explicitement. Source : https://github.com/pnpm/pnpm.io/blob/main/docs/settings/build.md . Les documents et réglages initiaux sont exclus du formateur.
