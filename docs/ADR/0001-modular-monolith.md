# ADR 0001 — Monolithe modulaire et multi-tenant

Date : 2026-10-28. Statut : proposé, socle réversible préparé.

Contexte : dépôt vierge, multiples domaines et invariants financiers forts, charge inconnue.
Décision : web Next.js, API Fastify, worker séparé, même monorepo et PostgreSQL ; domaines propriétaires de leurs données et outbox transactionnelle. Tenant organisation, boutiques multiples, memberships par boutique ; contraintes composites puis RLS avec rôle runtime non-owner.
Alternatives : microservices refusés à ce stade (transactions et exploitation trop coûteuses), base par tenant différée (migrations/exploitation disproportionnées), simple filtre tenant insuffisant comme seul contrôle ; NestJS viable mais couche supplémentaire sans besoin démontré.
Conséquences : discipline des modules et tests d'isolation nécessaires ; ne pas exporter le client Prisma aux composants web. Extraction future guidée par mesures, pas par anticipation.
Validation attendue : propriétaire produit/technique avant métier.
