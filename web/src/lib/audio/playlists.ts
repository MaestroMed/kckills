/**
 * Audio playlists for the floating wolf player.
 *
 * THREE contexts :
 *   * `homepage` — BCC vibe : ambient, anthemic, ramp-up. Plays on the
 *     landing experience to set the mood (le scroll TikTok du LoL = il
 *     faut une atmosphère)
 *   * `scroll` — high-energy montage : trap, EDM, hype. Plays under the
 *     scroll feed to give clip energy (existing /scroll BGM pattern)
 *   * `bcc` — the Antre de la BCC cave override. Single-track loop
 *     of N'Seven7 "OTT". Activated via setPlaylistOverride("bcc") when
 *     the Antre modal opens, cleared when it closes.
 *
 * `homepage` / `scroll` are managed via /admin/playlists. The wolf player
 * picks the right playlist based on the current route. `bcc` is NEVER
 * route-selected — only via explicit `setPlaylistOverride("bcc")`. This
 * keeps the cave audio context decoupled from the URL (the Antre is a
 * modal on /alumni/bo, not its own route).
 *
 * Tracks are YouTube video IDs (audio-only via hidden IFrame). Future
 * upgrade : host MP3s directly on R2 to enable Web Audio API real-time
 * waveform analysis (currently we render a stylised fake-waveform that
 * pulses with the play state).
 */

export interface BgmTrack {
  id: string;
  title: string;
  artist: string;
  /** YouTube video ID for the track. */
  youtubeId: string;
  /** Approximate duration in seconds (for progress UI). */
  durationSeconds: number;
  /** Tag for the admin filter chips. */
  genre:
    | "synthwave"
    | "trap"
    | "edm"
    | "dnb"
    | "chill"
    | "hype"
    | "ambient"
    | "anthemic";
  /** Optional cover URL. Falls back to the YouTube thumbnail if absent. */
  coverUrl?: string;
}

export type PlaylistId = "homepage" | "scroll" | "bcc";

/**
 * Subset of PlaylistId that the operator can re-curate via /admin/playlists.
 * The `bcc` playlist is intentionally NOT included — it's the cave's
 * canonical signature loop and lives only in DEFAULT_PLAYLISTS.
 */
export type EditablePlaylistId = "homepage" | "scroll";
export const EDITABLE_PLAYLIST_IDS: EditablePlaylistId[] = [
  "homepage",
  "scroll",
];

/**
 * Default homepage playlist — BCC vibe.
 * Ambient / anthemic / build-up tracks that suit the landing page mood.
 * Operator can re-curate via /admin/playlists.
 */
export const DEFAULT_HOMEPAGE_PLAYLIST: BgmTrack[] = [
  {
    id: "rise",
    title: "RISE",
    artist: "The Glitch Mob, Mako & The Word Alive",
    youtubeId: "fB8TyLTD7EE",
    durationSeconds: 211,
    genre: "anthemic",
  },
  {
    id: "legends-never-die",
    title: "Legends Never Die",
    artist: "Against The Current",
    youtubeId: "r6zIGXun57U",
    durationSeconds: 179,
    genre: "anthemic",
  },
  {
    id: "enemy",
    title: "Enemy",
    artist: "Imagine Dragons & JID",
    youtubeId: "F5tSoaJ93ac",
    durationSeconds: 214,
    genre: "anthemic",
  },
  {
    id: "guns-for-hire",
    title: "Guns for Hire",
    artist: "Woodkid",
    youtubeId: "pKNEx-9OqRM",
    durationSeconds: 227,
    genre: "anthemic",
  },
  {
    id: "playground",
    title: "Playground",
    artist: "Bea Miller",
    youtubeId: "3jfI-z__GY0",
    durationSeconds: 231,
    genre: "chill",
  },
  {
    id: "ma-meilleure-ennemie",
    title: "Ma Meilleure Ennemie",
    artist: "Stromae & Pomme",
    youtubeId: "j-RpvIuazmc",
    durationSeconds: 169,
    genre: "anthemic",
  },
];

/**
 * Default scroll playlist — high-energy "montage" anthems for the
 * TikTok-style scroll feed.
 *
 * Wave 35 #10 (2026-05-28) — full curation pass after user reported
 * "royalty marche pas" + "j'ai dit de mettre le bon phoenix aussi".
 * Two issues to address :
 *
 *   1. Royalty was wired to youtubeId `C5rCADZbfGs` — that upload is
 *      taken down / non-embeddable. Replaced with the OFFICIAL
 *      NoCopyrightSounds upload : `cXOY9b_Bv-w` (Egzod & Maestro
 *      Chives ft. Neoni, released 2020-02-21).
 *
 *   2. Phoenix is now PRIMARY (top of queue) since it's the canonical
 *      LoL montage track. Worlds 2019 official animated MV ID is
 *      `i1IKnWDecwA` on the @LeagueOfLegends channel.
 *
 * Curation principle : every track is either an official Riot Games
 * anthem or an NCS-released banger, both of which permit iframe
 * embedding. No covers, no fan remixes — those get DMCA'd and the
 * IDs go dead. The order is "best-known bangers first" so the player
 * opens on a hook the user will recognise.
 *
 * Failsafe : the player now has an `onError` handler (use-floating-
 * player.tsx) that auto-advances when YT returns error 100/101/150
 * (video not found / embedding disabled / region blocked). So even
 * if one ID goes dead in the future, the playlist keeps flowing.
 */
export const DEFAULT_SCROLL_PLAYLIST: BgmTrack[] = [
  {
    id: "phoenix",
    title: "Phoenix",
    artist: "Cailin Russo & Chrissy Costanza",
    youtubeId: "i1IKnWDecwA",
    durationSeconds: 208,
    genre: "anthemic",
  },
  {
    id: "rise",
    title: "RISE",
    artist: "The Glitch Mob, Mako & The Word Alive",
    youtubeId: "fB8TyLTD7EE",
    durationSeconds: 211,
    genre: "anthemic",
  },
  {
    id: "legends-never-die",
    title: "Legends Never Die",
    artist: "Against The Current",
    youtubeId: "r6zIGXun57U",
    durationSeconds: 179,
    genre: "anthemic",
  },
  {
    id: "warriors",
    title: "Warriors",
    artist: "Imagine Dragons",
    youtubeId: "fmI_Ndrxy14",
    durationSeconds: 171,
    genre: "anthemic",
  },
  {
    id: "awaken",
    title: "Awaken",
    artist: "Valerie Broussard & Ray Chen",
    youtubeId: "zF5Ddo9JdpY",
    durationSeconds: 152,
    genre: "anthemic",
  },
  {
    id: "ignite",
    title: "Ignite",
    artist: "Zedd",
    youtubeId: "Zasx9hjo4WY",
    durationSeconds: 227,
    genre: "edm",
  },
  {
    id: "worlds-collide",
    title: "Worlds Collide",
    artist: "Nicki Taylor",
    youtubeId: "4Twd965VzX4",
    durationSeconds: 217,
    genre: "anthemic",
  },
  {
    id: "take-over",
    title: "Take Over",
    artist: "Jeremy McKinnon, MAX, Henry",
    youtubeId: "KbNL9ZyB49c",
    durationSeconds: 226,
    genre: "anthemic",
  },
  {
    id: "burn-it-all-down",
    title: "Burn It All Down",
    artist: "PVRIS",
    youtubeId: "1Z6CHioIn3s",
    durationSeconds: 212,
    genre: "anthemic",
  },
  {
    id: "star-walkin",
    title: "Star Walkin'",
    artist: "Lil Nas X",
    youtubeId: "HYsz1hP0BFo",
    durationSeconds: 214,
    genre: "hype",
  },
  {
    id: "gods",
    title: "GODS",
    artist: "NewJeans",
    youtubeId: "C3GouGa0noM",
    durationSeconds: 256,
    genre: "anthemic",
  },
  {
    id: "heavy-is-the-crown",
    title: "Heavy Is The Crown",
    artist: "Linkin Park",
    youtubeId: "R8OqqaBwcl8",
    durationSeconds: 271,
    genre: "anthemic",
  },
  {
    id: "pop-stars",
    title: "POP/STARS",
    artist: "K/DA",
    youtubeId: "UOxkGD8qRB4",
    durationSeconds: 203,
    genre: "edm",
  },
  {
    id: "more",
    title: "MORE",
    artist: "K/DA",
    youtubeId: "3VTkBuxU4yk",
    durationSeconds: 231,
    genre: "edm",
  },
  {
    id: "the-baddest",
    title: "THE BADDEST",
    artist: "K/DA",
    youtubeId: "RkID8_gnTxw",
    durationSeconds: 176,
    genre: "edm",
  },
  {
    id: "villain",
    title: "VILLAIN",
    artist: "K/DA",
    youtubeId: "xoWxv2yZXLQ",
    durationSeconds: 214,
    genre: "edm",
  },
  {
    id: "giants",
    title: "GIANTS",
    artist: "True Damage",
    youtubeId: "sVZpHFXcFJw",
    durationSeconds: 199,
    genre: "hype",
  },
  {
    id: "lightbringer",
    title: "Lightbringer",
    artist: "Pentakill",
    youtubeId: "oUiOylPbfV0",
    durationSeconds: 297,
    genre: "hype",
  },
  {
    id: "enemy",
    title: "Enemy",
    artist: "Imagine Dragons & JID",
    youtubeId: "F5tSoaJ93ac",
    durationSeconds: 214,
    genre: "anthemic",
  },
  {
    id: "playground",
    title: "Playground",
    artist: "Bea Miller",
    youtubeId: "3jfI-z__GY0",
    durationSeconds: 231,
    genre: "chill",
  },
  {
    id: "ma-meilleure-ennemie",
    title: "Ma Meilleure Ennemie",
    artist: "Stromae & Pomme",
    youtubeId: "j-RpvIuazmc",
    durationSeconds: 169,
    genre: "anthemic",
  },
  {
    id: "royalty",
    title: "Royalty",
    artist: "Egzod & Maestro Chives",
    youtubeId: "lW9ep22YmlM",
    durationSeconds: 224,
    genre: "trap",
  },
  {
    id: "phoenix-ncs",
    title: "Phoenix [NCS]",
    artist: "Netrum & Halvorsen",
    youtubeId: "yH88qRmgkGI",
    durationSeconds: 238,
    genre: "synthwave",
  },
  {
    id: "on-on",
    title: "On & On",
    artist: "Cartoon ft. Daniel Levi",
    youtubeId: "K4DyBUG242c",
    durationSeconds: 208,
    genre: "edm",
  },
  {
    id: "invincible",
    title: "Invincible",
    artist: "DEAF KEV",
    youtubeId: "J2X5mJ3HDYE",
    durationSeconds: 274,
    genre: "edm",
  },
  {
    id: "heroes-tonight",
    title: "Heroes Tonight",
    artist: "Janji ft. Johnning",
    youtubeId: "3nQNiWdeH2Q",
    durationSeconds: 209,
    genre: "edm",
  },
  {
    id: "warriors-epic",
    title: "Warriors (Epic)",
    artist: "2WEI",
    youtubeId: "pEZIYGN5HIo",
    durationSeconds: 205,
    genre: "anthemic",
  },
  // Wave 41 (2026-07-14) — Riot anthem expansion. Mehdi : "rajouter Warriors
  // (2020), The Call, Still Here, les dernières aussi… tous les bons sons de
  // LoL". All official Riot Games Music / cinematic uploads (embeddable, stable
  // IDs verified via oEmbed) so they don't go dead like the old fan re-uploads.
  {
    id: "warriors-2020",
    title: "Warriors (Season 2020)",
    artist: "2WEI & Edda Hayes",
    youtubeId: "aR-KAldshAE",
    durationSeconds: 210,
    genre: "anthemic",
  },
  {
    id: "the-call",
    title: "The Call",
    artist: "2WEI, Louis Leibfried, Edda Hayes",
    youtubeId: "HtHrjFJGDys",
    durationSeconds: 191,
    genre: "anthemic",
  },
  {
    id: "still-here",
    title: "Still Here",
    artist: "Forts, Tiffany Aris & 2WEI",
    youtubeId: "EcwLGLBS2cE",
    durationSeconds: 233,
    genre: "anthemic",
  },
  {
    id: "sacrifice",
    title: "Sacrifice",
    artist: "G.E.M. (Worlds 2025)",
    youtubeId: "pzt6SmvGpXk",
    durationSeconds: 233,
    genre: "anthemic",
  },
  {
    id: "what-could-have-been",
    title: "What Could Have Been",
    artist: "Sting & Ray Chen (Arcane)",
    youtubeId: "liPu1_aPH5k",
    durationSeconds: 213,
    genre: "chill",
  },
  // Wave 43 (2026-07-17) — Mehdi : « OST de fou » anime epic + musique d'edit
  // (Solo Leveling, AoT, JJK Mahoraga, phonk, classiques montage LoL,
  // Hopes and Dreams). Tous les IDs vérifiés via oEmbed le 2026-07-17 ;
  // le onError du player auto-skip toute future ID morte.
  {
    id: "gotta-get-stronger",
    title: "I've Gotta Get Stronger (Epic)",
    artist: "Solo Leveling OST",
    youtubeId: "9oXwP29nZHQ",
    durationSeconds: 222,
    genre: "hype",
  },
  {
    id: "ashes-on-the-fire",
    title: "Ashes on The Fire",
    artist: "Kohta Yamamoto (Attack on Titan)",
    youtubeId: "Qy79rdqIY0U",
    durationSeconds: 213,
    genre: "anthemic",
  },
  {
    id: "mahoraga",
    title: "Divine General Mahoraga",
    artist: "Jujutsu Kaisen S2 OST",
    youtubeId: "S24V8t3r0Uw",
    durationSeconds: 205,
    genre: "hype",
  },
  {
    id: "malevolent-shrine",
    title: "Malevolent Shrine",
    artist: "Jujutsu Kaisen S2 OST",
    youtubeId: "jm5rqq_SP8Q",
    durationSeconds: 195,
    genre: "hype",
  },
  {
    id: "hopes-and-dreams",
    title: "Hopes and Dreams",
    artist: "Toby Fox (Undertale)",
    youtubeId: "wbO3p7_Mf30",
    durationSeconds: 213,
    genre: "anthemic",
  },
  {
    id: "the-rumbling",
    title: "The Rumbling",
    artist: "SiM (Attack on Titan)",
    youtubeId: "OBqw818mQ1E",
    durationSeconds: 203,
    genre: "hype",
  },
  {
    id: "youseebiggirl",
    title: "YouSeeBIGGIRL/T:T",
    artist: "Hiroyuki Sawano (Attack on Titan)",
    youtubeId: "wvFmOIkuOfg",
    durationSeconds: 340,
    genre: "anthemic",
  },
  {
    id: "call-of-silence",
    title: "Call of Silence",
    artist: "Hiroyuki Sawano ft. Gemie (AoT)",
    youtubeId: "tc6q7M9STNg",
    durationSeconds: 253,
    genre: "chill",
  },
  {
    id: "aot-warriors-mix",
    title: "Warriors (AoT Mix)",
    artist: "Hiroyuki Sawano (Attack on Titan)",
    youtubeId: "PWrYfezIBFc",
    durationSeconds: 420,
    genre: "anthemic",
  },
  {
    id: "naruto-main-epic",
    title: "Naruto Main Theme (Epic Emotional)",
    artist: "Samuel Kim",
    youtubeId: "VjxquA5Ems0",
    durationSeconds: 243,
    genre: "anthemic",
  },
  {
    id: "naruto-baryon",
    title: "Naruto x Baryon Mode (Kurama Tribute)",
    artist: "Samuel Kim",
    youtubeId: "IApTa7uaWCU",
    durationSeconds: 260,
    genre: "anthemic",
  },
  {
    id: "tanjiro-no-uta-full",
    title: "Kamado Tanjirou no Uta",
    artist: "Demon Slayer OST (full ver.)",
    youtubeId: "QnkqCv0dZTk",
    durationSeconds: 280,
    genre: "chill",
  },
  {
    id: "tanjiro-no-uta-orch",
    title: "Tanjirou no Uta (Orchestral)",
    artist: "Samuel Kim (Demon Slayer)",
    youtubeId: "v7vpBjxNEb4",
    durationSeconds: 250,
    genre: "anthemic",
  },
  {
    id: "metamorphosis",
    title: "Metamorphosis",
    artist: "INTERWORLD",
    youtubeId: "317RHaFF7Xk",
    durationSeconds: 141,
    genre: "trap",
  },
  {
    id: "neon-blade",
    title: "Neon Blade",
    artist: "MoonDeity",
    youtubeId: "dvQJIgjlR3I",
    durationSeconds: 133,
    genre: "trap",
  },
  {
    id: "neon-blade-2",
    title: "Neon Blade 2",
    artist: "MoonDeity",
    youtubeId: "ThQhIABzCFs",
    durationSeconds: 150,
    genre: "trap",
  },
  {
    id: "murder-in-my-mind",
    title: "Murder In My Mind",
    artist: "Kordhell",
    youtubeId: "w-sQRS-Lc9k",
    durationSeconds: 152,
    genre: "trap",
  },
  {
    id: "sahara",
    title: "Sahara",
    artist: "Hensonn",
    youtubeId: "zSyDfRg6_Q4",
    durationSeconds: 172,
    genre: "trap",
  },
  {
    id: "after-dark",
    title: "After Dark",
    artist: "Mr.Kitty",
    youtubeId: "Cl5Vkd4N03Q",
    durationSeconds: 258,
    genre: "chill",
  },
  {
    id: "centuries",
    title: "Centuries",
    artist: "Fall Out Boy",
    youtubeId: "LBr7kECsjcQ",
    durationSeconds: 229,
    genre: "hype",
  },
  {
    id: "my-demons",
    title: "My Demons",
    artist: "Starset",
    youtubeId: "p-N_y1bZtRw",
    durationSeconds: 235,
    genre: "anthemic",
  },
  {
    id: "courtesy-call",
    title: "Courtesy Call",
    artist: "Thousand Foot Krutch",
    youtubeId: "ocpDEOXABWg",
    durationSeconds: 249,
    genre: "hype",
  },
  {
    id: "believer",
    title: "Believer",
    artist: "Imagine Dragons",
    youtubeId: "7wtfhZwyrcc",
    durationSeconds: 217,
    genre: "anthemic",
  },
  {
    id: "unity",
    title: "Unity",
    artist: "TheFatRat",
    youtubeId: "n8X9_MgEdCg",
    durationSeconds: 248,
    genre: "edm",
  },
  {
    id: "xenogenesis",
    title: "Xenogenesis",
    artist: "TheFatRat",
    youtubeId: "Fa0TFjpCAD0",
    durationSeconds: 234,
    genre: "edm",
  },
];

/**
 * BCC cave playlist — the Antre's signature loop.
 *
 * Single track : N'Seven7 "OTT" (the "ahou ahou" anthem that gave its
 * name to the Mur des Ahou Ahou). When the cave opens, we override the
 * wolf player's playlist to this, set the player's auto-advance to
 * loop back onto the same track (single-item queue + auto-advance
 * modulo 1 = same track restarts), and force-play.
 *
 * Operator can NOT recurate this via /admin/playlists — it's the cave's
 * canonical soundtrack. If we ever want a multi-track cave playlist,
 * just append entries here.
 */
export const DEFAULT_BCC_PLAYLIST: BgmTrack[] = [
  {
    id: "ott-nseven7",
    title: "OTT (Ahou Ahou)",
    artist: "N'Seven7",
    youtubeId: "YNzvHb92xqY",
    durationSeconds: 212,
    genre: "trap",
  },
];

export const DEFAULT_PLAYLISTS: Record<PlaylistId, BgmTrack[]> = {
  homepage: DEFAULT_HOMEPAGE_PLAYLIST,
  scroll: DEFAULT_SCROLL_PLAYLIST,
  bcc: DEFAULT_BCC_PLAYLIST,
};

/**
 * Pick the playlist for a given route.
 * `/` → homepage, `/scroll*` → scroll, `/kill/[id]` → scroll (cinematic),
 * everything else → homepage default.
 *
 * NOTE: this NEVER returns "bcc" — the cave playlist is opted into via
 * `setPlaylistOverride("bcc")` from the AntreOfBCC component, not via
 * route matching. The cave is a modal on /alumni/bo, not its own route.
 */
export function playlistForRoute(pathname: string): PlaylistId {
  if (pathname === "/") return "homepage";
  if (pathname.startsWith("/scroll")) return "scroll";
  if (pathname.startsWith("/kill/")) return "scroll";
  return "homepage"; // default
}

/** Fisher-Yates shuffle. */
export function shufflePlaylist<T>(tracks: T[]): T[] {
  const arr = [...tracks];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The scroll feed's fixed opening sequence — always the first 5 tracks
 *  played, in THIS order, when arriving on /scroll, then the rest shuffled.
 *  Mehdi's signature intro. IDs must exist in DEFAULT_SCROLL_PLAYLIST. */
export const SCROLL_OPENER_IDS: readonly string[] = [
  "fB8TyLTD7EE", // RISE
  "fmI_Ndrxy14", // Warriors
  "zF5Ddo9JdpY", // Awaken (Season 2019 Cinematic)
  "i1IKnWDecwA", // Phoenix
  "r6zIGXun57U", // Legends Never Die
];

/** Shuffle that PINS a fixed opener sequence to the front (in the given
 *  order), then Fisher-Yates shuffles everything after it. Openers absent
 *  from `tracks` are skipped. Used for the scroll feed so the intro is always
 *  the same five anthems. */
export function shuffleWithOpeners<T extends { youtubeId: string }>(
  tracks: T[],
  openerIds: readonly string[],
): T[] {
  const byId = new Map(tracks.map((t) => [t.youtubeId, t] as const));
  const used = new Set<string>();
  const openers: T[] = [];
  for (const id of openerIds) {
    const t = byId.get(id);
    if (t && !used.has(id)) {
      openers.push(t);
      used.add(id);
    }
  }
  const rest = tracks.filter((t) => !used.has(t.youtubeId));
  return [...openers, ...shufflePlaylist(rest)];
}
