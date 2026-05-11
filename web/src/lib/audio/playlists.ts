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
    id: "ophelia",
    title: "Ophelia (Lyrical Lemonade Remix)",
    artist: "The Lumineers · Mura Masa",
    youtubeId: "0cIbxTQVwH4",
    durationSeconds: 220,
    genre: "ambient",
  },
  {
    id: "memories",
    title: "Memories",
    artist: "Conro",
    youtubeId: "tX7Nr8Vwoxc",
    durationSeconds: 224,
    genre: "anthemic",
  },
];

/**
 * Default scroll playlist — high-energy montage.
 * Trap / EDM / hype tracks that match the TikTok-style clip pacing.
 * Carries over from the original /scroll BGM pattern.
 */
export const DEFAULT_SCROLL_PLAYLIST: BgmTrack[] = [
  {
    id: "phoenix",
    title: "Phoenix",
    artist: "Netrum & Halvorsen",
    youtubeId: "p7ZsBPK656s",
    durationSeconds: 186,
    genre: "synthwave",
  },
  {
    id: "royalty",
    title: "Royalty",
    artist: "Egzod & Maestro Chives ft. Neoni",
    youtubeId: "C5rCADZbfGs",
    durationSeconds: 199,
    genre: "trap",
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
