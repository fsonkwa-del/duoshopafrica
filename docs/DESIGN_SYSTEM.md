# Design system — proposition

## Trois positionnements

1. **Confiance de proximité** : vert profond, ivoire, terre cuite ; typographie système, information calme et prix lisible. Convient au commerce quotidien et aux marchands ; recommandé pour le pilote.
2. **Énergie collective** : indigo et ambre, compositions plus rythmées autour des groupes ; risque de survaloriser l'achat groupé avant validation financière.
3. **Commerce professionnel** : bleu encre et neutres froids, forte densité de gestion ; adapté B2B, moins chaleureux pour découverte mobile.

## Direction recommandée, en attente de validation

Primary #12634F, accent #B64724, fond #FAF8F3, texte #192B27. Texte blanc sur primary ; texte sombre sur fond clair. Accent réservé aux repères et focus. Contrastes à calculer dans un contrôle automatisé puis vérifier navigateur avant déclarer WCAG AA atteint. Couleurs de marque injectées depuis packages/config ; valeurs neutres et échelle dans packages/ui. Aucun logo, domaine ni adresse de support inventé.

Typographie system-ui (aucun téléchargement de police), base 16 px, interligne 1,6, h1 adaptatif 40–80 px, corps long limité à 65 caractères environ. Espacement 4/8/12/16/24/32/48/64 ; rayons 12 px. Grille 4 colonnes mobile, 8 tablette, 12 bureau ; seuils 768/1200 px, largeur max 1152 px.

## Contrat des composants

Bouton : primary/secondary/destructive, taille tactile cible ≥ 44 px, état focus visible, disabled explicite et pending sans double soumission. Champs label permanent, aide et erreur liée par aria-describedby ; validation serveur prioritaire. Prix : devise, unité, condition groupée et taxes ; jamais couleur seule. Cartes produit : image dimensions fixées/alt pertinent, vendeur, nom, prix et disponibilité ; pas de lien imbriqué dans un autre lien.
Skeleton : réservé au chargement réel, dimensions fixes, aria-busy sur conteneur ; reduced-motion. Empty state : raison et action possible ; erreur réseau réessayable ; confirmation financière annoncée par status après réponse serveur uniquement. Notifications critiques persistantes et reliées à la commande. Dialogues : focus piégé/restauré, touche Échap selon sûreté et titre accessible.

## Langues, accès et performance

FR/EN au premier écran, traductions par clés stables, parité testée, Intl pour montants et dates. RTL préparé via propriétés CSS logiques et dir ; aucune langue RTL livrée. Navigation clavier, lien d'évitement, landmarks, heading unique h1. Ne pas présenter une conformité WCAG atteinte avant tests axe et QA humaine. Images AVIF/WebP responsives futures, SSR et JS client limité ; pas de tracker tiers par défaut.

## État du socle UI

Notice, Feature, tokens et page responsive FR/EN présents. Formulaires, dialogues, cartes produit, tables et skeletons restent spécifiés, à implémenter dans leurs incréments métier. Mode clair initial ; mode sombre différé pour éviter une promesse non vérifiée.

## Contrastes calculés le 2026-10-28

Luminance sRGB : primary/blanc 7,18:1 ; accent/fond 5,05:1 ; texte/fond 13,97:1. Ces paires passent le seuil 4,5:1 du texte normal ; cela ne prouve pas la conformité des composants ou des écrans.

## Palette retenue le 2026-10-29 (demande utilisateur : couleurs inspirées de Pinduoduo)

Primary #D7261C (rouge proche du #E02E24 de Pinduoduo, foncé pour atteindre AA), accent #C2410C, fond #F5F5F5, cartes et panneaux #FFFFFF, texte #151516, bordures #E5E5E5, notices #FFF4E5, badges #FEF2F1. Prix affichés en rouge. Contrastes calculés : blanc/primary 5,02:1 ; primary/fond 4,6:1 ; accent/fond 4,75:1 ; primary/badge 4,59:1 ; texte/fond 16,74:1. Seules les couleurs s'inspirent de Pinduoduo : ni logo, ni nom, ni mise en page de cette marque ne sont repris. La palette « Confiance de proximité » ci-dessus est remplacée.
