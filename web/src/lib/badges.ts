/**
 * Gamification badges — earned by community actions on KCKILLS.
 *
 * Badge definitions live here (frontend). The `profiles.badges` JSONB column
 * in Supabase stores the earned badge slugs per user. Earning logic runs
 * server-side (API routes or worker) and writes to the JSONB array.
 *
 * Display: badge chips appear on user profiles and next to comments.
 */

export interface BadgeDef {
  slug: string;
  name: string;
  icon: string;
  description: string;
  color: string;
  /** Condition description (for tooltip) */
  condition: string;
}

export const BADGES: BadgeDef[] = [
  {
    slug: "first_rater",
    name: "First Rater",
    icon: "\u2B50",
    description: "A not\u00e9 son premier kill",
    color: "#C8AA6E",
    condition: "Noter 1 kill",
  },
  {
    slug: "critic",
    name: "Critic",
    icon: "\uD83C\uDFAC",
    description: "A not\u00e9 50+ kills",
    color: "#0AC8B9",
    condition: "50 ratings",
  },
  {
    slug: "commentator",
    name: "Commentateur",
    icon: "\uD83D\uDCAC",
    description: "A post\u00e9 son premier commentaire",
    color: "#F0E6D2",
    condition: "1 commentaire",
  },
  {
    slug: "analyst",
    name: "Analyste",
    icon: "\uD83D\uDD0D",
    description: "A comment\u00e9 20+ kills",
    color: "#2196F3",
    condition: "20 commentaires",
  },
  {
    slug: "curator",
    name: "Curator",
    icon: "\uD83C\uDFA8",
    description: "A soumis un community clip approuv\u00e9",
    color: "#FF9800",
    condition: "1 clip approuv\u00e9",
  },
  {
    slug: "blue_wall",
    name: "Blue Wall",
    icon: "\uD83D\uDFE6",
    description: "Fan v\u00e9rifi\u00e9 KC",
    color: "#0057FF",
    condition: "A trouv\u00e9 le Konami Code",
  },
  {
    slug: "og_fan",
    name: "OG Fan",
    icon: "\uD83D\uDC51",
    description: "Pr\u00e9sent depuis le d\u00e9but",
    color: "#C8AA6E",
    condition: "Compte cr\u00e9\u00e9 dans les 30 premiers jours",
  },
  {
    slug: "penta_witness",
    name: "Penta Witness",
    icon: "\uD83D\uDD25",
    description: "A vu et not\u00e9 un pentakill",
    color: "#E84057",
    condition: "Rating sur un kill penta",
  },
];

export function getBadgeDef(slug: string): BadgeDef | undefined {
  return BADGES.find((b) => b.slug === slug);
}

export function getBadgeDefs(slugs: string[]): BadgeDef[] {
  return slugs
    .map((s) => getBadgeDef(s))
    .filter((b): b is BadgeDef => b !== undefined);
}
