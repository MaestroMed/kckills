/**
 * hls-loader.ts — dynamic-import wrapper for hls.js.
 *
 * Wave 11 / Agent DE — adaptive bitrate scroll player.
 *
 * hls.js is ~80KB gzipped and is ONLY needed on browsers that don't have
 * native HLS support (i.e. anything that isn't Safari iOS / macOS). To
 * keep the /scroll initial bundle slim, we lazy-load the library on first
 * use via this single shared dynamic import. Once the module promise has
 * resolved, every subsequent caller gets the cached instance for free —
 * no double-fetch, no double-parse, no extra bundle entry.
 *
 *   getHls()          → Promise<HlsModule>
 *   isMseSupported()  → boolean (synchronous, gates the fallback path)
 *
 * SSR-safe : every browser API is feature-detected via `typeof`. Calling
 * `getHls()` server-side would still resolve the import promise, so we
 * guard against that too — Next's build pipeline tree-shakes the import
 * out of the server bundle thanks to the dynamic-import boundary.
 *
 * Memory : the module promise is module-scoped, so it's effectively a
 * singleton for the page lifetime. Reloading hls.js per video element
 * was 80ms+ overhead per slot in benchmarks during Wave 6 — not what we
 * want on a 60Hz scroll feed.
 */

type HlsModule = typeof import("hls.js");

let hlsModulePromise: Promise<HlsModule> | null = null;

/**
 * Resolve the hls.js module, lazy-loading it on first call.
 *
 * Throws (rejects the promise) if the browser doesn't support MSE — every
 * caller that lands here has already determined the video element doesn't
 * have native HLS, so without MSE we genuinely can't play HLS at all.
 * Caller is expected to fall back to a plain MP4 src in that case.
 */
export function getHls(): Promise<HlsModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("hls.js cannot be loaded server-side"));
  }
  if (!isMseSupported()) {
    return Promise.reject(
      new Error("MediaSource Extensions unavailable — hls.js cannot run"),
    );
  }
  if (!hlsModulePromise) {
    hlsModulePromise = import("hls.js");
  }
  return hlsModulePromise;
}

/**
 * Synchronous MSE support check. In 2026 every evergreen browser supports
 * MSE — even Safari has had it since iOS 13. The `typeof` guard makes the
 * check SSR-safe and the optional-chain protects against ancient WebViews
 * (rare but non-zero on the long tail of Android devices).
 */
export function isMseSupported(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as {
    MediaSource?: { isTypeSupported?: (s: string) => boolean };
    WebKitMediaSource?: unknown;
  };
  return Boolean(w.MediaSource ?? w.WebKitMediaSource);
}

/**
 * Test-only helper — clears the cached module promise so unit tests can
 * exercise the fresh-load path. Not exported in the typed API surface; the
 * underscore prefix signals private-by-convention.
 */
export function _resetHlsLoaderForTests(): void {
  hlsModulePromise = null;
}
