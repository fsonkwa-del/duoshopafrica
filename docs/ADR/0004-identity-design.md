# ADR 0004 — Identité, i18n et marque

Date : 2026-10-28. Statut : proposé.

Identité : OIDC vérifié avec fournisseur à choisir, sessions opaques 256 bits hashées en DB, cookie sécurisé et révocation serveur. Ne pas développer un système mot de passe artisanal ; aucune dépendance SaaS payante choisie. MFA admin avant toute route sensible.
Design : confiance de proximité, système typographique natif pour limiter bande passante, marque et couleurs dans config, FR/EN dans package de traductions, Intl pour XAF. CSS logique et direction locale préparent RTL sans déclarer langue RTL livrée.
Alternatives : JWT persistant côté navigateur rejeté au profit d'une révocation simple et réduction de l'exposition XSS ; police distante et clone concurrent écartés. Coût : stockage sessions et validation accessibilité complète à réaliser.
