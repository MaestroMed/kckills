/**
 * Manifest-aware asset URL resolution for published kills.
 *
 * Migration 026 added the `kills.assets_manifest` JSONB column, which
 * is the new source of truth for clip / thumbnail / og / hls URLs.
 * The legacy `clip_url_*`, `thumbnail_url`, `og_image_url`,
 * `hls_master_url` columns remain populated as a back-compat fallback,
 * so every consumer in the app must prefer the manifest first then
 * fall through to the flat columns.
 *
 * This module centralises that fallback chain so the same logic lives
 * in exactly one place — `pickAssetUrl` for a single typed URL,
 * `pickBestForViewport` for the multi-priority video-source pick that
 * mirrors `FeedPlayerPool.pickSrc`, and `getAssetMetadata` for
 * width/height/duration/version metadata used by callers that want to
 * avoid layout shift.
 *
 * Server-safe: pure functions, no Supabase client, no React hooks.
 */
import type {
  KillAssetManifestEntry,
  KillAssetsManifest,
  PublishedKillRow,
} from "./supabase/kills";

/** Re-export so callers can import everything from one place without
 *  having to know about the supabase/kills module. */
export type { KillAssetManifestEntry, KillAssetsManifest };

/** Every asset type the worker can attach to a kill via the
 *  kill_assets table (migration 026). Keys mirror the enum values
 *  used by the worker's manifest builder. */
export type AssetType =
  | "horizontal"
  | "vertical"
  | "vertical_low"
  | "thumbnail"
  | "hls_master"
  | "og_image"
  | "preview_gif";

/** Subset of PublishedKillRow this module touches — kept structural so
 *  callers that build a slimmer kill view (e.g. the FeedPlayerPool
 *  PoolItem) can still pass it in without repackaging. The legacy
 *  fallback columns are all optional because some callers project a
 *  manifest-only view of the kill. */
export interface KillAssetsView {
  assets_manifest?: KillAssetsManifest | null;
  clip_url_horizontal?: string | null;
  clip_url_vertical?: string | null;
  clip_url_vertical_low?: string | null;
  hls_master_url?: string | null;
  thumbnail_url?: string | null;
  og_image_url?: string | null;
}

/**
 * Read the URL of a single asset type, preferring the manifest
 * (migration 026) and falling back to the legacy flat columns.
 *
 * Returns null when neither source carries the asset — the caller
 * decides whether to skip rendering, render a placeholder, or chain
 * a different asset type.
 */
export function pickAssetUrl(
  kill: KillAssetsView,
  type: AssetType,
): string | null {
  const manifestUrl = kill.assets_manifest?.[type]?.url;
  if (manifestUrl) return manifestUrl;

  // Legacy fallback chain — preserved for rows clipped before
  // migration 026 ran. preview_gif has no legacy column, so it
  // returns null whenever the manifest doesn't carry one.
  switch (type) {
    case "horizontal":
      return kill.clip_url_horizontal ?? null;
    case "vertical":
      return kill.clip_url_vertical ?? null;
    case "vertical_low":
      return kill.clip_url_vertical_low ?? null;
    case "thumbnail":
      return kill.thumbnail_url ?? null;
    case "hls_master":
      return kill.hls_master_url ?? null;
    case "og_image":
      return kill.og_image_url ?? null;
    case "preview_gif":
      return null;
  }
}

/**
 * Result of picking the best playable URL for the current viewport.
 * The `type` field tells the caller WHICH asset was selected so they
 * can pull matching width/height (via `getAssetMetadata`) for the
 * <video> aspect-ratio CSS, the right poster, etc.
 */
export interface BestForViewportPick {
  url: string;
  type: AssetType;
}

/**
 * Pick the best video URL for the active viewport.
 *
 * Mirrors the priority chain used by FeedPlayerPool.pickSrc :
 *
 *   1. lowQuality + vertical_low      → bandwidth saver
 *   2. desktop  + horizontal          → 16:9 native
 *   3. vertical                       → mobile / desktop fallback
 *
 * Falls back through the legacy flat columns via `pickAssetUrl` at
 * each step, so the same priority order works for both manifest-aware
 * and legacy-only rows.
 *
 * Returns null only when the kill has NO playable video of any type
 * (data-only rows from gol.gg historical backfill). Callers must
 * handle null and render a stats-only card variant.
 */
export function pickBestForViewport(
  kill: KillAssetsView,
  opts: { isDesktop: boolean; lowQuality: boolean },
): BestForViewportPick | null {
  if (opts.lowQuality) {
    const url = pickAssetUrl(kill, "vertical_low");
    if (url) return { url, type: "vertical_low" };
  }
  if (opts.isDesktop) {
    const url = pickAssetUrl(kill, "horizontal");
    if (url) return { url, type: "horizontal" };
  }
  const vertical = pickAssetUrl(kill, "vertical");
  if (vertical) return { url: vertical, type: "vertical" };
  // Exhausted preferences — try the remaining types as a last resort
  // so we play SOMETHING rather than nothing.
  const horizontal = pickAssetUrl(kill, "horizontal");
  if (horizontal) return { url: horizontal, type: "horizontal" };
  const verticalLow = pickAssetUrl(kill, "vertical_low");
  if (verticalLow) return { url: verticalLow, type: "vertical_low" };
  return null;
}

/**
 * Read the manifest entry for a given asset type — width/height/
 * duration_ms/size_bytes/version. Returns null when the manifest is
 * absent (legacy rows) or doesn't carry this type. Callers use the
 * width/height to set <video> or <Image> aspect-ratio CSS without
 * layout shift.
 *
 * NOTE: width/height/duration/size can each individually be null even
 * when the entry exists — the worker's probe_video() can fail on
 * specific files. Treat each numeric as "best-effort hint" not
 * "guaranteed present".
 */
export function getAssetMetadata(
  kill: KillAssetsView,
  type: AssetType,
): KillAssetManifestEntry | null {
  return kill.assets_manifest?.[type] ?? null;
}

/**
 * Convenience helper for next/image consumers : turn a manifest entry
 * into the (width, height) tuple Next/image needs for the `sizes` and
 * intrinsic dimension props. Returns null when either dim is missing
 * so the caller can fall back to a hardcoded breakpoint string.
 */
export function getAssetDimensions(
  kill: KillAssetsView,
  type: AssetType,
): { width: number; height: number } | null {
  const entry = getAssetMetadata(kill, type);
  if (!entry) return null;
  if (entry.width == null || entry.height == null) return null;
  return { width: entry.width, height: entry.height };
}
