/** Real KC assets — photos, logos, team data from LoL Esports API */

export const KC_LOGO = "https://static.lolesports.com/teams/1704714951336_KC.png";

// 🐛 2026-04-28 fix : keys are intentionally `Capitalised` for consistency
// (the underlying data is mixed-case — kyeahoo lowercase vs Canna/Busio/Yike/
// Caliste capitalised). Always look up via `getPlayerPhoto()` below for a
// case-insensitive read so /player/Kyeahoo (typed with capital K) gets the
// same hero portrait as /player/kyeahoo (followed from a roster pill).
//
// 2026-05-09 — extended with the historical KC roster lineage so the
// HomeRosterEraCarousel ("La Genèse" → "Le Renouveau") can show real
// player portraits across 2021-2026 instead of falling back to champion
// splash art. URLs sourced from :
//   - Supabase players table image_url (Rekkles, Upset, Vladi already
//     populated by an earlier worker enrichment pass)
//   - lolesports.com active rosters (113, Adam, Targamas, Saken still
//     play LEC / La Ligue Française elsewhere)
// Still missing (retired or in non-tracked regions) :
//   Cabochard, Cinkrof, Closer, Hantera, xMatty — fall through to
//   the splash-art champion fallback.
const PLAYER_PHOTOS_INTERNAL: Record<string, string> = {
  // Current 2026 roster
  Canna: "https://static.lolesports.com/players/1774651372836_canna.png",
  Kyeahoo: "https://static.lolesports.com/players/1774652002153_kyeahoo.png",
  Busio: "https://static.lolesports.com/players/1774651329556_busio.png",
  Yike: "https://static.lolesports.com/players/1768550195190_Yike-01.png",
  Caliste: "https://static.lolesports.com/players/1774651348279_caliste.png",
  // 2024 Pari Coréen
  Vladi: "https://static.lolesports.com/players/1774652694212_vladi.png",
  Upset: "https://static.lolesports.com/players/1774652671712_upset.png",
  // 2022 L'Ère Rekkles
  Rekkles: "https://static.lolesports.com/players/1768550499548_Rekkles-01.png",
  "113": "https://static.lolesports.com/players/1737733765521_113.png",
  // Multi-era (2021/2022/2023 KC core)
  Adam: "https://static.lolesports.com/players/1754472615484_image6134.png",
  Targamas: "https://static.lolesports.com/players/1754471520680_image6329.png",
  Saken: "https://static.lolesports.com/players/1705026448862_saken.png",
  // 2026-05-09 — recovered from Liquipedia/Fandom CDN (lolesports.com
  // dropped these portraits because the players retired from LEC).
  // 4/5 of the previously-missing historical KC roster ; Closer (2024
  // jungler) doesn't have a Liquipedia page image and falls through
  // to the splash-art fallback.
  Cabochard: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/c/cc/GMB-Cabochard-2015spring.jpg",
  Cinkrof: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/c/c4/OG_Cinkrof_2017_Spring.png",
  Hantera: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/6/60/SLY_Hantera_2020_Split_1.png",
  xMatty: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/1/11/FNCA_xMatty_2019_Split_1.png",
  // 2026-05-09 — Closer (Can Çelik), KC 2024 jungler. Liquipedia
  // disambig page is Closer_(Can_Çelik) ; the 2024 jungler IGN was
  // confused earlier with the Brazilian "Closer (Pedro de Paula)".
  Closer: "https://static.wikia.nocookie.net/lolesports_gamepedia_en/images/e/e9/RBE_Closer_2018_Split_2.png",
};

/**
 * Case-insensitive PLAYER_PHOTOS proxy — keeps backwards-compatible
 * `PLAYER_PHOTOS["name"]` syntax across ~30 call sites while making
 * the lookup tolerant of any capitalisation variant ("Kyeahoo",
 * "kyeahoo", "KYEAHOO" all return the same URL).
 */
export const PLAYER_PHOTOS: Record<string, string> = new Proxy(
  PLAYER_PHOTOS_INTERNAL,
  {
    get(target, prop: string) {
      if (typeof prop !== "string") return undefined;
      // Direct hit — preserves the canonical capitalisation perf path.
      if (Object.prototype.hasOwnProperty.call(target, prop)) {
        return target[prop];
      }
      // Case-insensitive fallback — O(n) over the small roster only
      // when the direct hit missed.
      const lower = prop.toLowerCase();
      for (const k of Object.keys(target)) {
        if (k.toLowerCase() === lower) return target[k];
      }
      return undefined;
    },
  },
);

/**
 * Wave 38 — KC roster lineage ordered NEWEST → OLDEST, used by the /vs
 * character-select so the grid reads like the club's history : current
 * five first (TOP→JGL→MID→ADC→SUP), then each earlier era's arrivals.
 * A player who spans several eras appears at his most recent slot only.
 */
export const KC_ROSTER_RECENCY: string[] = [
  // 2026 — Le Renouveau
  "Canna", "Yike", "Kyeahoo", "Caliste", "Busio",
  // 2025 — Le Sacre / First Stand / Le Drame
  "Vladi", "Targamas",
  // 2024 — LEC rookie year / Pari Coréen
  "Closer", "Upset", "Cabochard",
  // 2023 — LFL → LEC transition
  "Saken", "113",
  // 2022 — L'Ère Rekkles
  "Rekkles", "Hantera",
  // 2021 — La Genèse
  "Adam", "Cinkrof", "xMatty",
];

const ROSTER_RECENCY_INDEX: Record<string, number> = Object.fromEntries(
  KC_ROSTER_RECENCY.map((ign, i) => [ign.toLowerCase(), i]),
);

/** Position in the newest→oldest roster lineage. Unknown names sink to
 *  the end (Infinity) — callers alphabetise those among themselves. */
export function rosterRecencyIndex(ign: string): number {
  return ROSTER_RECENCY_INDEX[ign.toLowerCase()] ?? Number.POSITIVE_INFINITY;
}

/** Canonical display capitalisation for a KC ign — the PLAYER_PHOTOS /
 *  KC_ROSTER_RECENCY spelling when known ("kyeahoo" → "Kyeahoo"),
 *  first-letter-uppercased otherwise. The players table carries mixed-
 *  case duplicates from early backfills ; every UI list should render
 *  ONE canonical spelling. */
export function getCanonicalPlayerName(ign: string): string {
  const lower = ign.toLowerCase();
  for (const k of Object.keys(PLAYER_PHOTOS_INTERNAL)) {
    if (k.toLowerCase() === lower) return k;
  }
  for (const k of KC_ROSTER_RECENCY) {
    if (k.toLowerCase() === lower) return k;
  }
  return ign.length > 0 ? ign[0].toUpperCase() + ign.slice(1) : ign;
}

export const TEAM_LOGOS: Record<string, string> = {
  "KC": "https://static.lolesports.com/teams/1704714951336_KC.png",
  "G2": "https://static.lolesports.com/teams/G2-FullonDark.png",
  "FNC": "https://static.lolesports.com/teams/1631819669150_fnc-2021-worlds.png",
  "VIT": "https://static.lolesports.com/teams/1675865863968_Vitality_FullColor.png",
  "TH": "https://static.lolesports.com/teams/1672933861879_Heretics-Full-Color.png",
  "GX": "https://static.lolesports.com/teams/1765897105091_GIANTX-logotype-white.png",
  "SK": "https://static.lolesports.com/teams/1643979272144_SK_Monochrome.png",
  "MKOI": "https://static.lolesports.com/teams/1734012609283_MKOI_FullColor_Blue.png",
  "NAVI": "https://static.lolesports.com/teams/1752746833620_NAVI_FullColor.png",
  "RGE": "https://static.lolesports.com/teams/1705054928404_RGE.png",
  "SHFT": "https://static.lolesports.com/teams/1765897071435_600px-Shifters_allmode.png",
  "LR": "https://static.lolesports.com/teams/1736206905390_LR1.png",
  "KCB": "https://static.lolesports.com/teams/1765897112519_WHITE.png",
};

export const BCC_AUDIO_URL = "https://www.youtube.com/watch?v=YNzvHb92xqY";
