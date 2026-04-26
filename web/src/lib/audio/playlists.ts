/**
 * Audio playlists for the floating wolf player.
 *
 * TWO contexts :
 *   * `homepage` — BCC vibe : ambient, anthemic, ramp-up. Plays on the
 *     landing experience to set the mood (le scroll TikTok du LoL = il
 *     faut une atmosphère)
 *   * `scroll` — high-energy montage : trap, EDM, hype. Plays under the
 *     scroll feed to give clip energy (existing /scroll BGM pattern)
 *
 * Both are managed via /admin/playlists. The wolf player picks the
 * right playlist based on the current route (`/` → homepage, `/scroll*`
 * → scroll, anywhere else → user's last choice).
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

export type PlaylistId = "homepage" | "scroll";

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

export const DEFAULT_PLAYLISTS: Record<PlaylistId, BgmTrack[]> = {
  homepage: DEFAULT_HOMEPAGE_PLAYLIST,
  scroll: DEFAULT_SCROLL_PLAYLIST,
};

/**
 * Pick the playlist for a given route.
 * `/` → homepage, `/scroll*` → scroll, `/kill/[id]` → scroll (cinematic),
 * everything else → user's last choice.
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
