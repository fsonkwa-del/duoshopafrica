# ADR 0005 — Zitadel comme fournisseur d'identité OIDC

Date : 2026-10-28. Statut : accepté (choix utilisateur, 28/10/2026). Complète ADR 0004.

## Décision

Zitadel, auto-hébergeable, open source, OIDC certifié, MFA (TOTP, passkeys) et export des comptes. L'API DuoShop est un client OIDC standard (openid-client 6.8.8) : aucune dépendance au SDK Zitadel. Elle reste donc portable vers un autre fournisseur conforme.

## Flux retenu

1. `GET /v1/auth/login` : state, nonce et code_verifier aléatoires, tentative stockée (state haché, TTL 10 min), cookie `__Host-login` liant le state au navigateur. Redirection vers Zitadel avec PKCE S256 et `ui_locales`.
2. `GET /v1/auth/callback` : state égal au cookie (comparaison à temps constant), tentative consommée atomiquement (pas de rejeu), échange du code avec vérification issuer, audience, nonce, signature et PKCE par openid-client.
3. `email_verified = true` obligatoire. `auth_link_identity` (SECURITY DEFINER, seul droit du runtime) retrouve l'identité (issuer, sub) ou la lie à un compte existant par email vérifié normalisé, sinon crée le compte. Une identité déjà liée n'est jamais réaffectée.
4. Session opaque DuoShop (ADR 0004), `mfa = amr contient "mfa"`, 12 h absolue, 30 min d'inactivité. Les jetons Zitadel ne sont pas conservés.
5. Redirection finale uniquement vers un chemin localisé interne (`/fr/...` ou `/en/...`).

Application Zitadel : type Web, authentification `none` (client public PKCE), `idTokenUserinfoAssertion` actif pour recevoir l'email dans l'id_token, URI de retour `<origine web>/v1/auth/callback`. En dev, le web Next réécrit `/v1/*` vers l'API pour garder une origine unique, comme le fera le reverse proxy.

## Conséquences et points ouverts

- Hébergement Zitadel en staging/prod (instance dédiée vs Zitadel Cloud), sauvegardes, domaine et TLS : à décider, aucun compte créé.
- Zitadel v4 impose Login V2 : il faut déployer l'interface `zitadel-login` (ou une interface DuoShop basée sur l'API Session) pour un login navigateur. Elle n'est pas encore installée en local.
- Exigence MFA par rôle : la donnée `mfa` est fiable (vérifiée contre Zitadel réel) ; son application aux routes admin arrive avec B02.
- Déconnexion : session DuoShop révoquée ; la session Zitadel (SSO) n'est pas terminée (`end_session` à ajouter).
- Le rattachement par email vérifié suppose un seul issuer de confiance ; ajouter un second fournisseur exigera de revoir cette règle.
