/**
 * Thèmes de la page d'accueil.
 *
 * Un thème règle :
 *   · la palette de l'accueil (variables CSS --theme-* posées sur la page) ;
 *   · les deux étendards du header, chacun avec son drap, son fil et son
 *     blason : à gauche la KC (maillot du moment), à droite l'adversaire un
 *     jour de match ;
 *   · les premiers titres du lecteur sur l'accueil (avant ceux de la météo) ;
 *   · une affiche de match (« spotlight ») qui prend le hero.
 *
 * Choix du thème (activeHomeTheme), dans l'ordre :
 *   1. `?theme=<id>` / KCKILLS_HOME_THEME (aperçu, galerie /themes) ;
 *   2. le prochain match officiel de KC (lib/next-match-server) quand il tombe
 *      dans sa fenêtre — n'importe quel adversaire connu de lib/team-brands ;
 *   3. les thèmes datés de HOME_THEMES ;
 *   4. le thème maison.
 *
 * Côté client, la page pose le thème résolu en JSON (data-home-theme-json) :
 * les étendards et le lecteur le lisent là (pageHomeTheme), sans refaire le
 * choix.
 */
import { teamBrand, WORLDS_2026_TEAMS, type TeamBrand } from "./team-brands";

export interface BannerLook {
  /** Drap : deux teintes marbrées (sombre → claire), 0xRRGGBB. */
  fabricA: number;
  fabricB: number;
  /** Reflet satiné du drap. */
  sheen: number;
  /** Lueur du drap au passage du rayon. */
  glow: number;
  /** Fil de la broderie (bordure, filet, blason). */
  thread: "gold" | "silver";
  /** Blason brodé (image locale, même origine). */
  logo: string;
  /** Dossier des images de repli (etendard-gauche/droite.webp). */
  posterDir: string;
}

export interface HomeThemePalette {
  /** Couleur dominante du thème (maillot, titres secondaires). */
  primary: string;
  /** Accent (or KC par défaut). */
  accent: string;
  /** Lueur des éléments vivants (halo, compte à rebours). */
  glow: string;
  /** Voile posé sur la photo du hero. */
  veil: string;
  /** Couleur de l'adversaire (cadre de son blason, ticker). */
  rival?: string;
}

export interface HomeThemeSpotlight {
  opponentCode: string;
  opponentName: string;
  opponentLogo: string;
  /** Coup d'envoi (UTC) ; absent = date à confirmer (aperçus de la galerie). */
  kickoffISO?: string;
  competition: string;
  stage: string;
  format: string;
}

export interface HomeTheme {
  id: string;
  label: string;
  /** Fenêtre d'activation, ISO UTC, [from, to[. */
  from?: string;
  to?: string;
  kicker: string;
  palette: HomeThemePalette;
  banners: { left: BannerLook; right: BannerLook };
  openerIds: readonly string[];
  spotlight?: HomeThemeSpotlight;
}

/** Données minimales du thème pour le client (étendards, lecteur). */
export type ClientHomeTheme = Pick<HomeTheme, "id" | "banners" | "openerIds">;

// ─── les draps ────────────────────────────────────────────────────────────

/** Bleu KC d'origine. */
export const KC_HOME_LOOK: BannerLook = { fabricA: 0x041652, fabricB: 0x0a37b8, sheen: 0x3d6cff, glow: 0x3f6dff, thread: "gold", logo: "/images/kc-logo.png", posterDir: "/images/etendards" };
/** Maillot Worlds 2026 : blanc et or (boutique KC / Fulllife, octobre 2026). */
export const KC_WORLDS_LOOK: BannerLook = { fabricA: 0xcdc6b8, fabricB: 0xf7f4ee, sheen: 0xfff6e4, glow: 0xfff0d2, thread: "gold", logo: "/images/kc-logo.png", posterDir: "/images/etendards/worlds-2026" };

export function rivalLook(t: TeamBrand): BannerLook {
  return { fabricA: t.fabricA, fabricB: t.fabricB, sheen: t.sheen, glow: t.glow, thread: t.thread, logo: t.logo, posterDir: `/images/etendards/teams/${t.code}` };
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

// ─── thèmes ───────────────────────────────────────────────────────────────

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
  banners: { left: KC_HOME_LOOK, right: KC_HOME_LOOK },
  openerIds: [],
};

/** Warriors — Imagine Dragons, hymne du Mondial 2014 : premier titre les jours de Mondial. */
const WORLDS_OPENERS = ["fmI_Ndrxy14"] as const;
const AHEAD_MS = 20 * 3600_000; // l'affiche monte 20 h avant le coup d'envoi
const AFTER_MS = 6 * 3600_000; // et reste 6 h après

export interface MatchInfo {
  kickoffISO?: string;
  competition: string;
  stage: string;
  format: string;
}

/** Thème « jour de match au Mondial » contre `opp` : maillot blanc et or à gauche, l'adversaire à droite. */
export function worldsMatchTheme(opp: TeamBrand, m: MatchInfo): HomeTheme {
  const k = m.kickoffISO ? Date.parse(m.kickoffISO) : null;
  return {
    id: `mondial-2026-${opp.code.toLowerCase()}`,
    label: `Mondial 2026 · KC – ${opp.code}`,
    from: k ? new Date(k - AHEAD_MS).toISOString() : undefined,
    to: k ? new Date(k + AFTER_MS).toISOString() : undefined,
    kicker: "Mondial 2026 · Jour de match",
    palette: {
      primary: "#F5F1E8",
      accent: "#D9B46A",
      glow: "rgba(255,236,200,0.55)",
      veil: "linear-gradient(180deg, rgba(245,241,232,0.16), rgba(1,10,19,0.25) 60%)",
      rival: hex(opp.glow),
    },
    banners: { left: KC_WORLDS_LOOK, right: rivalLook(opp) },
    openerIds: WORLDS_OPENERS,
    spotlight: { opponentCode: opp.code, opponentName: opp.name, opponentLogo: opp.logo, ...m },
  };
}

const C9 = teamBrand("C9")!;

/** Thèmes datés (en plus des matchs trouvés automatiquement dans le calendrier). */
export const HOME_THEMES: readonly HomeTheme[] = [
  // KC – C9, Mondial 2026, Play-ins, BO5, 15/10/2026 18:00 UTC (getSchedule lolesports, relevé le 15/10).
  worldsMatchTheme(C9, { kickoffISO: "2026-10-15T18:00:00Z", competition: "Mondial 2026", stage: "Play-ins", format: "BO5" }),
];

/** Tous les thèmes explorables dans la galerie : maison + KC contre chaque équipe du Mondial 2026. */
export const GALLERY_THEMES: readonly HomeTheme[] = [
  DEFAULT_HOME_THEME,
  ...WORLDS_2026_TEAMS.filter((t) => t.code !== "KC").map((t) => {
    const dated = HOME_THEMES.find((h) => h.spotlight?.opponentCode === t.code);
    return dated ?? worldsMatchTheme(t, { competition: "Mondial 2026", stage: t.phase === "Play-ins" ? "Play-ins" : "Système suisse", format: t.phase === "Play-ins" ? "BO5" : "BO1" });
  }),
];

/** Prochain match officiel (lib/next-match-server) → thème, s'il est dans sa fenêtre et l'adversaire connu. */
export interface NextMatchLike {
  kickoffISO: string;
  opponentCode: string;
  stage: string;
  league: string;
  format: string;
  isLive?: boolean;
}

export function themeForNextMatch(next: NextMatchLike | null | undefined, now: Date): HomeTheme | null {
  if (!next) return null;
  const brand = teamBrand(next.opponentCode);
  if (!brand || !/mondial|worlds/i.test(next.league)) return null;
  const k = Date.parse(next.kickoffISO);
  const t = now.getTime();
  if (!next.isLive && (t < k - AHEAD_MS || t > k + AFTER_MS)) return null;
  const stage = next.stage.split("·").pop()?.trim() || next.stage;
  return worldsMatchTheme(brand, { kickoffISO: next.kickoffISO, competition: "Mondial 2026", stage, format: next.format.toUpperCase() });
}

export function findHomeTheme(id: string): HomeTheme | undefined {
  return [...GALLERY_THEMES, ...HOME_THEMES].find((t) => t.id === id);
}

/** Thème actif au rendu serveur. */
export function activeHomeTheme(now: Date = new Date(), override?: string | null, next?: NextMatchLike | null): HomeTheme {
  if (override) {
    const forced = findHomeTheme(override);
    if (forced) return forced;
  }
  const fromSchedule = themeForNextMatch(next, now);
  if (fromSchedule) return fromSchedule;
  const t = now.getTime();
  return HOME_THEMES.find((th) => (!th.from || t >= Date.parse(th.from)) && (!th.to || t < Date.parse(th.to))) ?? DEFAULT_HOME_THEME;
}

export function toClientTheme(t: HomeTheme): ClientHomeTheme {
  return { id: t.id, banners: t.banners, openerIds: t.openerIds };
}

/**
 * Côté client : le thème posé par la page (data-home-theme-json), sinon
 * `?theme=` (labo, captures), sinon le thème daté.
 */
export function pageHomeTheme(): ClientHomeTheme {
  if (typeof window === "undefined") return toClientTheme(activeHomeTheme());
  const el = document.querySelector<HTMLElement>("[data-home-theme-json]");
  if (el?.dataset.homeThemeJson) {
    try {
      return JSON.parse(el.dataset.homeThemeJson) as ClientHomeTheme;
    } catch {
      /* thème daté */
    }
  }
  return toClientTheme(activeHomeTheme(new Date(), new URLSearchParams(window.location.search).get("theme")));
}
