/**
 * Thèmes de la page d'accueil — un thème par événement (jour de match,
 * maillot du moment, sacre…), choisi selon la date. En dehors de toute
 * fenêtre, c'est le thème « maison » (bleu KC, hymnes de la météo).
 *
 * Un thème règle :
 *   · la palette de l'accueil (variables CSS --theme-* posées sur la page) ;
 *   · le drap des étendards du header (couleurs du tissu, reflet, lueur) et
 *     leur image de repli ;
 *   · les premiers titres du lecteur sur l'accueil (avant ceux de la météo) ;
 *   · une affiche de match (« spotlight ») qui prend le hero.
 *
 * Aperçu : `?theme=<id>` sur l'accueil force un thème (côté client : étendards
 * et musique ; côté serveur : voir app/page.tsx).
 *
 * Ajouter un thème : une entrée dans HOME_THEMES, fenêtre en UTC. Pas de
 * chiffre ni de fait non vérifié dans les textes (source + date en commentaire).
 */

export interface HomeThemePalette {
  /** Couleur dominante du thème (maillot, titres secondaires). */
  primary: string;
  /** Accent (or KC par défaut). */
  accent: string;
  /** Lueur des éléments vivants (halo, compte à rebours). */
  glow: string;
  /** Voile posé sur la photo du hero (CSS, sans le dégradé du bas). */
  veil: string;
}

export interface HomeThemeBanner {
  /** Drap : deux teintes marbrées (sombre → claire), 0xRRGGBB. */
  fabricA: number;
  fabricB: number;
  /** Reflet satiné du drap. */
  sheen: number;
  /** Lueur du drap au passage du rayon. */
  glow: number;
  /** Dossier des images de repli (etendard-gauche/droite.webp). */
  posterDir: string;
}

export interface HomeThemeSpotlight {
  opponentCode: string;
  opponentName: string;
  /** Logo de l'adversaire (static.lolesports.com, autorisé par next.config). */
  opponentLogo: string;
  /** Coup d'envoi prévu (UTC) — l'heure réelle vient de /api/next-match. */
  kickoffISO: string;
  /** Compétition, phase, format — affichés tels quels. */
  competition: string;
  stage: string;
  format: string;
}

export interface HomeTheme {
  id: string;
  /** Nom court (labo, journal). */
  label: string;
  /** Fenêtre d'activation, ISO UTC, [from, to[. */
  from?: string;
  to?: string;
  /** Pastille au-dessus du titre du hero. */
  kicker: string;
  palette: HomeThemePalette;
  banner: HomeThemeBanner;
  /** Premiers titres de l'accueil (ids YouTube), avant ceux de la météo. */
  openerIds: readonly string[];
  spotlight?: HomeThemeSpotlight;
}

/** Thème maison : le bleu KC des étendards d'origine, les hymnes de la météo. */
export const DEFAULT_HOME_THEME: HomeTheme = {
  id: "maison",
  label: "Maison",
  kicker: "Karmine Corp · LEC",
  palette: {
    primary: "#0057FF",
    accent: "#C8AA6E",
    glow: "rgba(200,170,110,0.45)",
    veil: "linear-gradient(180deg, rgba(0,0,0,0.10), transparent 55%)",
  },
  banner: { fabricA: 0x041652, fabricB: 0x0a37b8, sheen: 0x3d6cff, glow: 0x3f6dff, posterDir: "/images/etendards" },
  openerIds: [],
};

export const HOME_THEMES: readonly HomeTheme[] = [
  {
    // KC – C9, Mondial 2026, Play-ins, BO5, le 15/10/2026 à 18:00 UTC
    // (getSchedule lolesports, relevé le 15/10/2026). Maillot Worlds 2026 :
    // blanc et or, col montant, blason Worlds (boutique KC / Fulllife).
    id: "worlds-2026-c9",
    label: "Mondial 2026 · KC – C9",
    from: "2026-10-14T22:00:00Z", // 15/10 00:00 à Paris
    to: "2026-10-16T02:00:00Z", // 16/10 04:00 à Paris
    kicker: "Mondial 2026 · Jour de match",
    palette: {
      primary: "#F5F1E8",
      accent: "#D9B46A",
      glow: "rgba(255,236,200,0.55)",
      veil: "linear-gradient(180deg, rgba(245,241,232,0.16), rgba(1,10,19,0.25) 60%)",
    },
    banner: { fabricA: 0xcdc6b8, fabricB: 0xf7f4ee, sheen: 0xfff6e4, glow: 0xfff0d2, posterDir: "/images/etendards/worlds-2026" },
    openerIds: ["fmI_Ndrxy14" /* Warriors — Imagine Dragons, hymne du Mondial 2014 */],
    spotlight: {
      opponentCode: "C9",
      opponentName: "Cloud9",
      opponentLogo: "https://static.lolesports.com/teams/1736924120254_C9Kia_IconBlue_Transparent_2000x2000.png",
      kickoffISO: "2026-10-15T18:00:00Z",
      competition: "Mondial 2026",
      stage: "Play-ins",
      format: "BO5",
    },
  },
];

/** Thème actif : `override` (id) s'il existe, sinon le premier dont la fenêtre contient `now`. */
export function activeHomeTheme(now: Date = new Date(), override?: string | null): HomeTheme {
  if (override) {
    const forced = override === DEFAULT_HOME_THEME.id ? DEFAULT_HOME_THEME : HOME_THEMES.find((t) => t.id === override);
    if (forced) return forced;
  }
  const t = now.getTime();
  return (
    HOME_THEMES.find((th) => (!th.from || t >= Date.parse(th.from)) && (!th.to || t < Date.parse(th.to))) ?? DEFAULT_HOME_THEME
  );
}

/** Côté client : thème actif, `?theme=` compris. */
export function clientHomeTheme(): HomeTheme {
  if (typeof window === "undefined") return activeHomeTheme();
  return activeHomeTheme(new Date(), new URLSearchParams(window.location.search).get("theme"));
}
