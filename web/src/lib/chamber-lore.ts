/**
 * chamber-lore.ts — Les Moments Maudits de la Chambre des Souffrances.
 *
 * La couche LORE curatée de /chambre (demande Mehdi 2026-07-17 : « faire
 * souffrir les fans progressivement » — la Akali, Zhou Yang-Bo, le split
 * oublié, KC LEONA, 113, Vladi, Targamas…). Chaque moment est une carte
 * spéciale intercalée dans son cercle : titre, récit, et un embed YouTube.
 *
 * Tous les youtubeId vérifiés via oEmbed le 2026-07-17. Un ID mort ne casse
 * rien (l'iframe YouTube affiche son propre message) mais préférer les
 * uploads officiels KC / documentaires (stables).
 *
 * Curation : ordre = profondeur du cercle (1 = pincement au cœur,
 * 10 = l'Enfer). Ajouter un moment = une entrée ici, rien d'autre à câbler.
 */

export interface ChamberLoreMoment {
  /** Cercle d'accueil (1-10) — aligné sur ChamberCircle.depth. */
  depth: number;
  /** Titre de la carte, style « moment maudit ». */
  title: string;
  /** Le récit — pourquoi ça fait mal. 2-3 phrases, ton narratif FR. */
  story: string;
  /** Époque, pour le badge (ex. « LFL 2023 »). */
  era: string;
  youtubeId: string;
}

export const CHAMBER_LORE: readonly ChamberLoreMoment[] = [
  {
    depth: 1,
    title: "Oh KC Saken",
    era: "L'hymne",
    story:
      "Avant la douleur, il y a l'amour. L'hymne que toute la KC Army " +
      "connaît par cœur — chante-le maintenant, tu ne chanteras plus en bas.",
    youtubeId: "zg2bLageifs",
  },
  {
    depth: 2,
    title: "« Ça sera 20 games de Leona pour moi »",
    era: "KC LEONA",
    story:
      "Un support enfermé dans un seul champion. La com' qui hurle « KC " +
      "LEONA » à chaque draft. Le meme est drôle — jusqu'à ce qu'on se " +
      "souvienne du classement de ce split-là.",
    youtubeId: "hNkTv7g6ifw",
  },
  {
    depth: 3,
    title: "Dos au mur",
    era: "LFL 2022",
    story:
      "L'ère Rekkles, 113 dans la jungle, et ces moves qui n'ont pas " +
      "tourné. Le documentaire d'une équipe qui joue sa survie — et la " +
      "sent glisser game après game.",
    youtubeId: "gfYpHBmgQGQ",
  },
  {
    depth: 4,
    title: "Targamas — Désillusions",
    era: "LEC 2024",
    story:
      "L'Ashe support, les critiques qui pleuvent, un vestiaire qui " +
      "encaisse. Targamas raconte lui-même la saison où tout le monde " +
      "avait un avis sur son champion pool.",
    youtubeId: "9FGzXpjjhlY",
  },
  {
    depth: 5,
    title: "Vladi — l'étoile filante",
    era: "Le Sacre → le burnout",
    story:
      "Le plus jeune mid champion LEC de l'histoire. MVP du Sacre. Puis " +
      "2 000 games de trop et un départ dont personne ne parle sans " +
      "baisser les yeux. Regarde comme il était brillant.",
    youtubeId: "lvIXa8YqP9I",
  },
  {
    depth: 6,
    title: "L'Akali qui a fait lever l'Europe",
    era: "LEC 2025",
    story:
      "KC vs SK. L'Akali fend la teamfight, les streamers hurlent, tout " +
      "semble possible. C'est ça le pire : on y a cru. Chaque cercle en " +
      "dessous te rappellera comment ça s'est fini.",
    youtubeId: "ds8G6IAjoHc",
  },
  {
    depth: 7,
    title: "The Last Chance",
    era: "Le split oublié — LFL 2023",
    story:
      "Le split que tout le monde veut oublier. Pas de playoffs pour la " +
      "première fois de l'histoire du club. Le documentaire que la KC " +
      "Army n'a regardé qu'une fois — et c'était déjà trop.",
    youtubeId: "MbygrI3G2rw",
  },
  {
    depth: 8,
    title: "Zhou Yang-Bo — 0 et 6",
    era: "LEC Winter 2024",
    story:
      "Le prodige chinois arrive avec des attentes cosmiques. 0-6 pour " +
      "commencer la LEC. Il explique face caméra ce qui ne va pas — et " +
      "quelques semaines plus tard, il n'est plus titulaire.",
    youtubeId: "DJ0UY310Hec",
  },
  {
    depth: 9,
    title: "Le coup de gueule",
    era: "La crise",
    story:
      "Quand Kameto lui-même prend le micro pour dire tout haut ce que " +
      "la KC Army pense tout bas, c'est que le fond est proche. Long, " +
      "cash, douloureux — nécessaire.",
    youtubeId: "x3b_JyorVws",
  },
  {
    depth: 9,
    title: "KC vs G2 — la Finale",
    era: "LEC",
    story:
      "Encore G2. Toujours G2. La rivalité qui définit l'ère LEC de la " +
      "Karmine — et qui, pour l'instant, ne penche que d'un côté.",
    youtubeId: "91rKEWIn5nM",
  },
  {
    depth: 10,
    title: "Le Cauchemar de la LEC",
    era: "La séparation des légendes",
    story:
      "Comment le rêve LEC a broyé le roster des légendes. Le récit " +
      "complet de la descente — à ne regarder que si ton cœur est déjà " +
      "en morceaux, il ne peut plus se casser davantage.",
    youtubeId: "B6m5VBcp9x4",
  },
  {
    depth: 10,
    title: "Game 5 — le back-to-back de trop",
    era: "LEC Spring 2026",
    story:
      "46 minutes. Un Nasus. Une finale de plus contre G2, une coupe de " +
      "plus qui part à Berlin. Le fond de la Chambre, c'est ici : " +
      "regarde, souffre, remonte — et reviens plus fort. 🔵⚪",
    youtubeId: "rzeIWKVDDic",
  },
];

/** Moments d'un cercle donné (profondeur 1-10). */
export function loreForDepth(depth: number): ChamberLoreMoment[] {
  return CHAMBER_LORE.filter((m) => m.depth === depth);
}
