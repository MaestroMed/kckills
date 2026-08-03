# Photos du hero

Déposer ici les images de fond du carrousel, puis décommenter l'entrée
correspondante dans `web/src/lib/hero-images.ts`.

Noms attendus par la liste :

- `ewc-walk-on-stage.jpg`      — l'équipe entre sur scène
- `ewc-team-hug.jpg`           — l'équipe réunie dans les bras
- `ewc-celebration-crowd.jpg`  — explosion de joie devant le public
- `ewc-caliste-hug.jpg`        — Caliste enlace un coéquipier
- `ewc-players-joy.jpg`        — célébration au bord de la scène
- `ewc-thumbs-up.jpg`          — le pouce levé vers le public

Format : JPEG, largeur ≥ 2000 px, qualité 80-85, moins de 500 Ko par fichier.
next/image produit ensuite les variantes (4 largeurs × avif/webp), inutile de
préparer plusieurs tailles.

La première entrée active de la liste est l'élément LCP de la page d'accueil :
y placer la photo la plus nette et la plus lisible.
