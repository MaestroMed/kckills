// ─── Tracked-team config (PR-loltok BA — feature-flagged transition) ────
//
// LoLTok will eventually track every LoL pro team. The pilot tracks
// only Karmine Corp. We expose two related constants :
//
//   * KC_PRIMARY_TEAM_SLUG / KC_TEAM_SLUG (legacy alias)
//       → the "default" team the homepage hero, /kc redirect and the
//         legacy KC-centric routes resolve to. Reads the env var so an
//         operator can flip the pilot to track a different headline
//         team without touching code.
//
//   * TRACKED_TEAM_SLUGS
//       → the comma-separated set of tracked slugs from
//         KCKILLS_TRACKED_TEAMS (default = ["karmine-corp"]).
//         Used by the multi-team /scroll feed and the league filters.
//
// Default values keep the EtoStark demo byte-identical : with no env
// vars set, both constants behave exactly like the pilot.
//
// IMPORTANT : `process.env.X` is read at BUILD time on the server.
// The browser bundle never sees server env vars unless they're
// `NEXT_PUBLIC_*`. These constants are imported from server components
// (RSC) — for client-side reads use the `NEXT_PUBLIC_KCKILLS_PRIMARY_TEAM_SLUG`
// fallback chain documented at the bottom of this file.

export const KC_PRIMARY_TEAM_SLUG: string =
  process.env.KCKILLS_PRIMARY_TEAM_SLUG ??
  process.env.NEXT_PUBLIC_KCKILLS_PRIMARY_TEAM_SLUG ??
  "karmine-corp";

/** @deprecated Use KC_PRIMARY_TEAM_SLUG. Kept for legacy KC-centric routes. */
export const KC_TEAM_SLUG = KC_PRIMARY_TEAM_SLUG;

/** Comma-separated list of tracked team slugs, parsed from
 *  KCKILLS_TRACKED_TEAMS. Special value "*" means "track all teams in the
 *  worker catalog" (LoLTok mode). Default = [KC_PRIMARY_TEAM_SLUG]. */
export const TRACKED_TEAM_SLUGS: string[] = (() => {
  const raw =
    process.env.KCKILLS_TRACKED_TEAMS ??
    process.env.NEXT_PUBLIC_KCKILLS_TRACKED_TEAMS ??
    "";
  const trimmed = raw.trim();
  if (!trimmed) return [KC_PRIMARY_TEAM_SLUG];
  if (trimmed === "*") return ["*"];
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
})();

/** True when the worker (and therefore this site) tracks more than one
 *  team. Used to gate the team-picker UI and the league switcher. */
export const IS_MULTI_TEAM_MODE: boolean =
  TRACKED_TEAM_SLUGS.length > 1 || TRACKED_TEAM_SLUGS[0] === "*";

export const ROLE_ORDER: Record<string, number> = {
  top: 0,
  jungle: 1,
  mid: 2,
  adc: 3,
  bottom: 3,
  support: 4,
};

export const KILL_TYPE_LABELS: Record<string, string> = {
  solo_kill: "Solo Kill",
  first_blood: "First Blood",
  double_kill: "Double Kill",
  triple_kill: "Triple Kill",
  quadra_kill: "Quadra Kill",
  penta_kill: "Penta Kill",
  ace: "Ace",
  shutdown: "Shutdown",
  regular: "Kill",
};

export const KILL_TYPE_COLORS: Record<string, string> = {
  solo_kill: "bg-purple-500/20 text-purple-300",
  first_blood: "bg-red-500/20 text-red-300",
  double_kill: "bg-orange-500/20 text-orange-300",
  triple_kill: "bg-orange-500/20 text-orange-300",
  quadra_kill: "bg-yellow-500/20 text-yellow-300",
  penta_kill: "bg-yellow-500/20 text-yellow-200",
  ace: "bg-green-500/20 text-green-300",
  shutdown: "bg-blue-500/20 text-blue-300",
  regular: "bg-gray-500/20 text-gray-300",
};

// ─── Data Dragon (CDN Riot) ──────────────────────────────────────────────
// Version épinglée — dernière release vérifiée le 12/08/2026 via
// https://ddragon.leagueoflegends.com/api/versions.json
const DDRAGON = "16.16.1";

// Wave 44 (audit roulette), durci audit 12/08/2026 — normalisation des noms
// champions vers les clés Data Dragon. La DB stocke des graphies variées :
// broadcast ("Kha'Zix", "Renata Glasc"), concaténée ("KhaZix", "RenataGlasc"),
// casse libre — mais DDragon exige sa clé interne exacte (Khazix, Renata,
// MonkeyKing…) sinon le CDN répond 403 et les icônes/splashes sont cassés.
//
// Lookup insensible à la casse et à la ponctuation : on strippe tout sauf
// les lettres puis on passe en minuscules avant de chercher dans la table.
// Seuls 9 champions (sur 173) ont une clé qui diffère de leur nom strippé —
// liste vérifiée le 12/08/2026 contre
// https://ddragon.leagueoflegends.com/cdn/16.16.1/data/en_US/champion.json
// Les autres entrées préservent la casse interne (KogMaw, LeeSin…) au cas où
// la source écrit le nom en minuscules.
const DDRAGON_KEY_FIX: Record<string, string> = {
  // — clé DDragon ≠ nom strippé (les 9 vrais cas spéciaux) —
  belveth: "Belveth", // Bel'Veth
  chogath: "Chogath", // Cho'Gath
  kaisa: "Kaisa", // Kai'Sa
  khazix: "Khazix", // Kha'Zix / KhaZix
  leblanc: "Leblanc", // LeBlanc
  wukong: "MonkeyKing", // Wukong
  nunuwillump: "Nunu", // Nunu & Willump
  renataglasc: "Renata", // Renata Glasc / RenataGlasc
  velkoz: "Velkoz", // Vel'Koz
  // — clé = nom strippé, mais casse interne à préserver —
  aurelionsol: "AurelionSol",
  drmundo: "DrMundo", // Dr. Mundo
  jarvaniv: "JarvanIV", // Jarvan IV
  kogmaw: "KogMaw", // Kog'Maw
  ksante: "KSante", // K'Sante
  leesin: "LeeSin",
  masteryi: "MasterYi",
  missfortune: "MissFortune",
  reksai: "RekSai", // Rek'Sai
  tahmkench: "TahmKench",
  twistedfate: "TwistedFate",
  xinzhao: "XinZhao",
  // NB : l'ancienne clé "FiddleSticks" répond 403 sur l'endpoint versionné —
  // la clé moderne "Fiddlesticks" (fallback générique) marche partout.
};

export function ddragonKey(championName: string): string {
  const stripped = championName.replace(/[^A-Za-z]/g, "");
  const fixed = DDRAGON_KEY_FIX[stripped.toLowerCase()];
  if (fixed) return fixed;
  // Cas générique : retirer espaces/apostrophes/points suffit (Renekton,
  // Ahri… restent inchangés). On capitalise la 1re lettre pour tolérer une
  // graphie source en minuscules ("renekton" → "Renekton").
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export function championIconUrl(championName: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON}/img/champion/${ddragonKey(championName)}.png`;
}

/** Full splash art — used as background in scroll mode */
export function championSplashUrl(championName: string, skinNum = 0): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${ddragonKey(championName)}_${skinNum}.jpg`;
}

/** Loading screen art — tall format, good for vertical */
export function championLoadingUrl(championName: string, skinNum = 0): string {
  return `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/${ddragonKey(championName)}_${skinNum}.jpg`;
}

export function formatGameTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
