/**
 * era-rosters.ts — curated roster snapshots per KC year.
 *
 * Source data : `lib/eras.ts` (period / color / roster string / coach).
 * The carousel needs a richer per-player shape than the era.roster
 * string can carry (signature champion for the splash background, role
 * normalized, photo URL when the player has one in PLAYER_PHOTOS).
 *
 * Why curated and not derived
 * ───────────────────────────
 * `getKCRoster()` in real-data.ts only sees matches that landed in the
 * worker's matches table — currently 2024 onward. For 2021/2022/2023
 * we have ZERO match rows. So the roster shapes for those years would
 * be empty if we tried to derive them from real-data.
 *
 * Instead we curate one signature roster per year from the era brief
 * in eras.ts, plus a per-player iconic champion (used for the splash
 * art when the player has no photo asset). The 6 entries here cover
 * 2021 → 2026 with a single representative roster per year — the
 * "this is the year of X" lineup that fans associate with that year.
 *
 * Updating
 * ────────
 * When KC announces a new lineup that defines a new year :
 *   1. Add a new era to `eras.ts` if it's a distinct phase.
 *   2. Add the roster entry below pointing at the era's id.
 *   3. The carousel auto-picks it up (sorted by year).
 *
 * For mid-year roster swaps (e.g. Caliste replacing Upset in 2025
 * Spring), pick the lineup that won the most attention in that year
 * — fans care about the "iconic" lineup, not the chronological churn.
 */

import { ERAS, type Era } from "@/lib/eras";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";

export type Role = "top" | "jungle" | "mid" | "bottom" | "support";

export interface EraRosterPlayer {
  ign: string;
  role: Role;
  /** Signature champion for the splash-art fallback when no photo. */
  signatureChampion: string;
  /** Photo URL from PLAYER_PHOTOS — `null` falls back to splash art. */
  imageUrl: string | null;
}

export interface EraRoster {
  /** Stable id for React key + URL hash navigation. */
  id: string;
  /** The year this roster represents (used for sort + dot label). */
  year: number;
  /** Short human label : "2021", "2022 · Rekkles", "2025 · Champions". */
  yearLabel: string;
  /** The era's flagship moniker — "La Genèse" / "L'Ère Rekkles". */
  label: string;
  /** Period string from the source era — "Spring 2021". */
  period: string;
  /** Hex color from the source era — drives gradient + accents. */
  color: string;
  /** Achievement chip — "🏆 LFL + 🏆 EU Masters". */
  result: string;
  /** Coach byline — "Striker" / "Reapered (Bok Han-gyu)". */
  coach: string;
  /** Exactly 5 players in TJM/JGL/MID/BOT/SUP order for visual consistency. */
  players: EraRosterPlayer[];
}

// ─── Per-player signature champions ─────────────────────────────
// Hand-curated based on each player's most iconic / most-played
// champion during their tenure on KC. Sources : Liquipedia + the
// player's own KC highlight reels on Kameto Clips. Used ONLY as the
// splash-art fallback — players with a PLAYER_PHOTOS entry render
// the photo instead.
const SIGNATURE_CHAMPS: Record<string, string> = {
  // 2021 La Genèse
  Adam: "Gnar",
  Cinkrof: "Hecarim",
  Saken: "Sylas",
  xMatty: "Aphelios",
  Targamas: "Rakan",

  // 2022 L'Ère Rekkles
  Cabochard: "Gnar",
  "113": "Viego",
  Rekkles: "Jinx",
  Hantera: "Lulu",

  // 2023 Renaissance / LEC arrival
  Caliste: "Caitlyn",

  // 2024 Pari Coréen
  Canna: "Aatrox",
  Closer: "Vi",
  Vladi: "Azir",
  Upset: "Caitlyn",

  // 2025 Sacre + 2026 Renouveau
  Yike: "Vi",
  kyeahoo: "Sylas",
  Busio: "Rakan",

  // Generic role-based fallback (defensive — every player above is
  // covered, but the carousel reads from a default if a name slips).
  __top: "Aatrox",
  __jungle: "Lee Sin",
  __mid: "Ahri",
  __bottom: "Caitlyn",
  __support: "Thresh",
};

function signatureChampion(ign: string, role: Role): string {
  return SIGNATURE_CHAMPS[ign] ?? SIGNATURE_CHAMPS[`__${role}`] ?? "Jhin";
}

function buildPlayer(ign: string, role: Role): EraRosterPlayer {
  // PLAYER_PHOTOS keys are case-sensitive ; try the ign as-is first,
  // then a lowercase variant for IGNs like "kyeahoo" that we store
  // unconventionally.
  const photo =
    PLAYER_PHOTOS[ign] ?? PLAYER_PHOTOS[ign.toLowerCase()] ?? null;
  return {
    ign,
    role,
    signatureChampion: signatureChampion(ign, role),
    imageUrl: photo,
  };
}

// ─── Curated roster snapshots per year ─────────────────────────
// One representative era per year. The carousel renders these in
// order. Each entry pulls color + period + result + coach from the
// referenced era in `eras.ts` so we don't duplicate truth.
//
// Players ordered by lane (TOP → SUP) so the visual layout matches
// the LoL convention readers expect. The role string in the source
// era roster is preserved — never auto-detected.

const ROSTER_RECIPES: Array<{
  eraId: string;
  year: number;
  yearLabel: string;
  players: Array<[string, Role]>;
}> = [
  {
    eraId: "lfl-2021-spring",
    year: 2021,
    yearLabel: "2021 · Genèse",
    players: [
      ["Adam", "top"],
      ["Cinkrof", "jungle"],
      ["Saken", "mid"],
      ["xMatty", "bottom"],
      ["Targamas", "support"],
    ],
  },
  {
    eraId: "lfl-2022-spring",
    year: 2022,
    yearLabel: "2022 · Rekkles",
    players: [
      ["Cabochard", "top"],
      ["113", "jungle"],
      ["Saken", "mid"],
      ["Rekkles", "bottom"],
      ["Hantera", "support"],
    ],
  },
  {
    eraId: "lfl-2023-summer",
    year: 2023,
    yearLabel: "2023 · Renaissance",
    players: [
      ["Cabochard", "top"],
      ["Cinkrof", "jungle"],
      ["Saken", "mid"],
      ["Caliste", "bottom"],
      ["Targamas", "support"],
    ],
  },
  {
    eraId: "lec-2024-summer",
    year: 2024,
    yearLabel: "2024 · Pari Coréen",
    players: [
      ["Canna", "top"],
      ["Closer", "jungle"],
      ["Vladi", "mid"],
      ["Upset", "bottom"],
      ["Targamas", "support"],
    ],
  },
  {
    eraId: "lec-2025-winter",
    year: 2025,
    yearLabel: "2025 · LE SACRE",
    players: [
      ["Canna", "top"],
      ["Yike", "jungle"],
      ["Vladi", "mid"],
      ["Caliste", "bottom"],
      ["Targamas", "support"],
    ],
  },
  {
    eraId: "lec-2026-versus",
    year: 2026,
    yearLabel: "2026 · Renouveau",
    players: [
      ["Canna", "top"],
      ["Yike", "jungle"],
      ["kyeahoo", "mid"],
      ["Caliste", "bottom"],
      ["Busio", "support"],
    ],
  },
];

function eraById(id: string): Era | undefined {
  return ERAS.find((e) => e.id === id);
}

/**
 * Build the full carousel data — pulls color + period + result + coach
 * from the referenced era in eras.ts so any future tweak there
 * propagates to the carousel.
 *
 * Returns the rosters sorted by year ascending (oldest to newest), so
 * the carousel naturally tells the story chronologically and lands
 * on "current" at the end of one rotation cycle.
 */
export function getEraRosters(): EraRoster[] {
  const rosters: EraRoster[] = [];
  for (const recipe of ROSTER_RECIPES) {
    const era = eraById(recipe.eraId);
    if (!era) continue; // era was renamed / dropped in eras.ts — skip silently
    rosters.push({
      id: recipe.eraId,
      year: recipe.year,
      yearLabel: recipe.yearLabel,
      label: era.label,
      period: era.period,
      color: era.color,
      result: era.result,
      coach: era.coach ?? "—",
      players: recipe.players.map(([ign, role]) => buildPlayer(ign, role)),
    });
  }
  return rosters.sort((a, b) => a.year - b.year);
}

/**
 * The default era to land on when the carousel mounts. Always the most
 * recent year (= the current era) so first paint shows what fans
 * expect today, and the auto-rotation walks back through the history.
 */
export function defaultEraIndex(rosters: EraRoster[]): number {
  if (rosters.length === 0) return 0;
  // Most-recent year = last in the chronologically sorted list.
  return rosters.length - 1;
}
