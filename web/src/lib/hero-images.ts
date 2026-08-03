import type { HeroImage } from "@/components/HeroImageCarousel";

/**
 * Images de fond du hero, dans leur ordre de passage.
 *
 * Le hero affichait une vidéo : un seul clip pesait 19,4 Mo, chargé en autoPlay
 * avant même le premier scroll. Il est remplacé par ce carrousel de photos,
 * servi par next/image.
 *
 * ─── Ordre ────────────────────────────────────────────────────────────────
 * Le montage suit une progression : l'image posée d'origine, puis l'entrée sur
 * scène, puis la tension qui se relâche, le cri, l'accolade, la mêlée devant le
 * public, et le regard caméra pour refermer. Huit secondes par plan, fondu de
 * trois secondes — un tour complet dure environ une minute.
 *
 * La première entrée est l'élément LCP de la page : elle doit rester une image
 * légère et déjà présente dans `public/`, jamais un nouveau fichier lourd.
 *
 * ─── Ajouter une photo ────────────────────────────────────────────────────
 * Déposer le fichier dans `web/public/images/hero/` puis ajouter son entrée
 * ici. Une entrée pointant vers un fichier absent afficherait un plan vide
 * pendant huit secondes — vérifier le chemin.
 *
 * Format attendu : JPEG, largeur 2000-2560 px, qualité 80-85. Inutile de monter
 * plus haut : `deviceSizes` plafonne à 1920 dans `next.config.ts`, tout pixel
 * au-delà est jeté au premier redimensionnement. Les sources 4096 px reçues ont
 * été ramenées à 2560 px pour cette raison (5,5 Mo → 2,3 Mo au total).
 *
 * `focus` déplace le recadrage quand le sujet n'est pas au centre : en plein
 * écran mobile, le cadrage par défaut coupe volontiers les visages, une valeur
 * autour de « 50% 35% » remonte sur le haut des corps.
 */
export const HERO_IMAGES: HeroImage[] = [
  {
    src: "/images/hero-bg.jpg",
    alt: "Karmine Corp sur la scène de l'Esports World Cup",
    focus: "50% 40%",
  },
  {
    src: "/images/hero/ewc-stage-walk.jpg",
    alt: "Les joueurs de Karmine Corp traversent la scène de l'Esports World Cup sous les projecteurs, le public debout derrière eux",
    focus: "52% 40%",
  },
  {
    src: "/images/hero/ewc-team-hug.jpg",
    alt: "L'équipe Karmine Corp réunie dans une accolade collective après la victoire, sous les lumières violettes de l'arène",
    focus: "51% 38%",
  },
  {
    src: "/images/hero/ewc-victory-roar.jpg",
    alt: "Un joueur de Karmine Corp hurle de joie, porté par ses coéquipiers, devant les gradins pleins",
    focus: "53% 36%",
  },
  {
    src: "/images/hero/ewc-desk-embrace.jpg",
    alt: "Deux joueurs de Karmine Corp s'enlacent devant leurs postes de jeu à la fin du match",
    focus: "48% 34%",
  },
  {
    // Format portrait (1290 × 1603) : en hero plein écran, seule une bande
    // horizontale est visible. Le cadrage haut garde les visages dedans.
    src: "/images/hero/ewc-crowd-celebration.jpg",
    alt: "Toute l'équipe Karmine Corp se jette sur un coéquipier pour célébrer, le public en liesse derrière la barrière",
    focus: "50% 30%",
  },
  {
    // Source la plus courte du lot (828 px de large) : nette sur mobile, un
    // peu douce en plein écran desktop. À remplacer si une version haute
    // définition de ce cliché est retrouvée.
    src: "/images/hero/ewc-thumbs-up.jpg",
    alt: "Un joueur de Karmine Corp lève le pouce vers le public à la sortie de scène",
    focus: "47% 35%",
  },
];
