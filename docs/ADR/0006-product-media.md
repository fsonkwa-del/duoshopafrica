# ADR 0006 — Photos produit et stockage objet

Date : 2026-10-29. Statut : accepté (validation utilisateur, 29/10/2026) ; fournisseur de production et analyse antivirus encore à choisir.

## Contexte

AC03 exige des produits avec photos. Les images envoyées par les vendeurs sont un vecteur d'attaque (fichier piégé, SVG scripté, métadonnées EXIF de localisation, contenu illicite) et un poste de coût (bande passante sur réseaux mobiles lents). Aucun stockage objet n'est disponible sur le poste de développement, et aucun fournisseur n'est contractualisé.

## Proposition

- Stockage S3-compatible privé, via le SDK S3 standard (fournisseur de production à choisir sans engagement automatique). Local : MinIO ne distribue plus de binaires (téléchargement HTTP 410, dernière release GitHub sans binaire, octobre 2025) ; SeaweedFS 4.48 (Apache-2.0, passerelle S3) est retenu pour le poste de développement.
- Envoi direct navigateur → bucket « quarantaine » par URL présignée (PUT, 5 Mo max, durée 5 min), sans transit par l'API.
- Traitement par le worker : contrôle du type réel (magic bytes, pas l'extension), JPEG/PNG/WebP seulement (SVG refusé), réencodage en WebP (plusieurs tailles), suppression des métadonnées EXIF, publication dans un bucket public en lecture seule via CDN.
- `ProductMedia` (tenantId, productId, clé, statut PENDING/READY/REJECTED, ordre, texte alternatif FR/EN obligatoire pour l'accessibilité). Un produit ne peut être publié qu'avec au moins une image READY, une fois ce lot livré.
- Analyse antivirus et modération : à décider (coût, prestataire, délai).

## Alternatives écartées

Stocker les images en base (coût, sauvegardes lourdes) ; disque local de l'API (non scalable, pas de séparation quarantaine/public) ; URL d'images externes (SSRF, contenu non maîtrisé, liens morts).

## Décision attendue

Valider l'approche, choisir le fournisseur de stockage et le service d'analyse.

Note d'implémentation : le web affiche les images par `<img>` (dimensions et `loading="lazy"`), la règle Biome `noImgElement` est désactivée pour `apps/web` : le redimensionnement est fait une fois par le worker, pas par l'optimiseur de Next à chaque requête.

## État d'implémentation (Sprint 5)

Livré et testé : `@duoshop/media` (détection par signature, refus SVG/GIF, limite 5 Mo et 40 Mpx, orientation, WebP ≤ 1200 px sans métadonnées), port `ObjectStorage` avec adaptateurs S3 et mémoire, `ProductMedia`, demande d'envoi présignée (type et taille signés, clé de quarantaine choisie par le serveur, 8 photos maximum, texte alternatif FR/EN obligatoire), traitement par le worker (`pending_media` / `complete_media`), affichage en vitrine des seules photos READY.

Non vérifié : l'adaptateur S3 contre un vrai serveur (l'exécution du binaire SeaweedFS téléchargé a été refusée par le contrôle de sécurité de la session et attend l'autorisation de l'utilisateur) ; l'envoi navigateur → bucket (CORS du bucket à configurer). Non tranché : exiger au moins une photo READY pour publier.
