/**
 * BGM Playlist for the /scroll feed.
 *
 * NCS / royalty-free tracks that loop in the background while scrolling.
 * Managed via /review backoffice (add/remove/reorder).
 *
 * Tracks are YouTube audio URLs — we use YouTube IFrame API in
 * audio-only mode (hidden player) to avoid hosting MP3s.
 *
 * Alternative: direct MP3 URLs on R2 if we want zero YouTube dependency.
 */

export interface BgmTrack {
  id: string;
  title: string;
  artist: string;
  /** YouTube video ID for the track */
  youtubeId: string;
  /** Duration in seconds (approximate, for progress display) */
  durationSeconds: number;
  /** Genre tag for UI display */
  genre: "synthwave" | "trap" | "edm" | "dnb" | "chill" | "hype";
}

/**
 * Default playlist — hardcoded for now, backoffice will manage later.
 * All NCS / Copyright Free.
 */
export const DEFAULT_PLAYLIST: BgmTrack[] = [
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

/** Shuffle a playlist (Fisher-Yates) */
export function shufflePlaylist(tracks: BgmTrack[]): BgmTrack[] {
  const arr = [...tracks];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
