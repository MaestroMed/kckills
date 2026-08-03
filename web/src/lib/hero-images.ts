import type { HeroImage } from "@/components/HeroImageCarousel";

/**
 * Images de fond du hero, dans leur ordre de passage.
 *
 * Le hero affichait une vidéo : un seul clip pesait 19,4 Mo, chargé en autoPlay
 * avant même le premier scroll. Il est remplacé par ce carrousel de photos,
 * servi par next/image.
 *
 * ─── Ajouter les photos EWC ────────────────────────────────────────────────
 * Déposer les fichiers dans `web/public/images/hero/` puis décommenter les
 * entrées correspondantes ci-dessous. Tant qu'un fichier est absent, laisser
 * sa ligne commentée : une entrée pointant vers une image inexistante afficherait
 * un plan vide pendant huit secondes.
 *
 * Format attendu : JPEG, largeur ≥ 2000 px, qualité 80-85. next/image produit
 * ensuite les variantes (4 largeurs, avif + webp). Éviter le PNG, inutilement
 * lourd pour de la photo. Viser moins de 500 Ko par fichier avant traitement.
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

  // ─── Photos EWC 2026 — à activer une fois les fichiers déposés ───────────
  // {
  //   src: "/images/hero/ewc-walk-on-stage.jpg",
  //   alt: "Les joueurs de Karmine Corp entrent sur la scène de l'EWC sous les projecteurs",
  //   focus: "50% 45%",
  // },
  // {
  //   src: "/images/hero/ewc-team-hug.jpg",
  //   alt: "L'équipe Karmine Corp réunie dans les bras les uns des autres après la victoire",
  //   focus: "50% 40%",
  // },
  // {
  //   src: "/images/hero/ewc-celebration-crowd.jpg",
  //   alt: "Les joueurs de Karmine Corp explosent de joie devant le public de l'EWC",
  //   focus: "50% 35%",
  // },
  // {
  //   src: "/images/hero/ewc-caliste-hug.jpg",
  //   alt: "Caliste enlace un coéquipier après la victoire contre T1",
  //   focus: "50% 30%",
  // },
  // {
  //   src: "/images/hero/ewc-players-joy.jpg",
  //   alt: "Célébration des joueurs de Karmine Corp au bord de la scène",
  //   focus: "50% 35%",
  // },
  // {
  //   src: "/images/hero/ewc-thumbs-up.jpg",
  //   alt: "Un joueur de Karmine Corp lève le pouce vers le public",
  //   focus: "50% 35%",
  // },
];
