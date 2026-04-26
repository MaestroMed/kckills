/**
 * Hero videos — shared types between server (route handlers, storage helper)
 * and client (admin editor + HeroClipBackground player).
 *
 * Wave 12 EF : Mehdi can now upload custom MP4 montages (intro reels, edits,
 * behind-the-scenes) to R2 and curate the homepage hero rotation. They take
 * priority over the YouTube fallback list — when an operator uploads at
 * least one hero video, the YouTube embeds become a tier-2 fallback.
 *
 * Persistence : the metadata list lives at `web/.cache/hero-videos.json`
 * (mirrors `/api/admin/playlists` pattern). The actual MP4 bytes live on
 * Cloudflare R2 at `hero/{uuid}/{slug}.mp4` — public, immutable, edge-
 * cached. Future upgrade : a `hero_videos` Supabase table once we move
 * past single-operator usage.
 */

export interface HeroVideo {
  /** UUID v4 — generated server-side at upload. */
  id: string;
  /** Short title overlaid bottom-left during playback. */
  title: string;
  /** Optional sub-line — context like "Le Sacre · Vladi MVP". */
  context?: string;
  /** R2 public URL of the MP4 (e.g. https://clips.kckills.com/hero/abc/montage.mp4). */
  videoUrl: string;
  /** Optional poster/thumbnail R2 URL — falls back to the first frame
   *  of the video element if absent. */
  posterUrl?: string;
  /** How long the hero plays this clip before rotating (milliseconds).
   *  Tip: match the actual clip length so it loops cleanly. */
  durationMs: number;
  /** Volume to play this clip at (0..1). Default 0.8.
   *  Audio plays only if the user has opted in via the wolf player
   *  (localStorage `kc_audio_enabled === '1'`) AND the hero is not muted. */
  audioVolume: number;
  /** Display order (lower = first). Server keeps the array sorted by this. */
  order: number;
  /** Optional tag for the admin filter chip rail. */
  tag?: HeroVideoTag;
  /** ISO-8601 timestamp of the upload. */
  createdAt: string;
}

/** Curator-friendly tags shown in the admin filter chip rail. */
export type HeroVideoTag = "montage" | "edit" | "behind-scenes" | "hype";

/** Result envelope for the upload route. Server returns either the freshly
 *  registered HeroVideo or a friendly French error string. */
export type HeroVideoUploadResult =
  | { ok: true; video: HeroVideo }
  | { ok: false; error: string };

/** Validates a value is a well-formed HeroVideo. Used by both the server
 *  (POST validation) and the client (defensive read). Keep in lockstep
 *  with the schema — missing fields = data loss. */
export function isHeroVideo(value: unknown): value is HeroVideo {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string"
    && /^[0-9a-f-]{36}$/i.test(v.id)
    && typeof v.title === "string"
    && v.title.length > 0
    && v.title.length <= 200
    && (v.context === undefined || (typeof v.context === "string" && v.context.length <= 200))
    && typeof v.videoUrl === "string"
    && /^https?:\/\//.test(v.videoUrl)
    && (v.posterUrl === undefined || (typeof v.posterUrl === "string" && /^https?:\/\//.test(v.posterUrl)))
    && typeof v.durationMs === "number"
    && v.durationMs > 0
    && v.durationMs <= 5 * 60 * 1000
    && typeof v.audioVolume === "number"
    && v.audioVolume >= 0
    && v.audioVolume <= 1
    && typeof v.order === "number"
    && (v.tag === undefined || ["montage", "edit", "behind-scenes", "hype"].includes(v.tag as string))
    && typeof v.createdAt === "string"
  );
}

/** Validates an array of HeroVideos (used by the admin POST). */
export function isHeroVideoList(value: unknown): value is HeroVideo[] {
  return Array.isArray(value) && value.every(isHeroVideo);
}

/** Hard cap to prevent runaway lists. The hero rotates through every entry
 *  so 20 is already 5+ minutes of content. */
export const MAX_HERO_VIDEOS = 20;

/** File-size cap for direct multipart uploads. Vercel Pro caps the request
 *  body at 100 MB ; we leave a comfy margin and recommend < 60 MB so the
 *  client doesn't hit the proxy. */
export const MAX_HERO_VIDEO_BYTES = 60 * 1024 * 1024;

/** Allowed MIME types for hero video uploads. */
export const ALLOWED_HERO_VIDEO_MIMES = ["video/mp4", "video/quicktime"] as const;
