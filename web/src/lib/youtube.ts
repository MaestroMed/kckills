/**
 * YouTube URL helpers — extract 11-char video IDs from various URL shapes.
 *
 * Used to build hero carousels from hand-curated `links` arrays in
 * `lib/eras.ts` and `lib/alumni.ts` (which mix `watch?v=`, `youtu.be/`,
 * and `results?search_query=` URLs).
 */

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

/**
 * Returns the 11-char video ID if `url` is a YouTube watch / youtu.be link.
 * Search-result URLs and unrelated links return `null`.
 */
export function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "youtu.be") {
      const id = u.pathname.slice(1);
      return VIDEO_ID_RE.test(id) ? id : null;
    }

    if (host === "youtube.com" || host === "m.youtube.com" || host.endsWith(".youtube.com")) {
      // /watch?v=ID
      const v = u.searchParams.get("v");
      if (v && VIDEO_ID_RE.test(v)) return v;
      // /embed/ID, /shorts/ID, /live/ID
      const m = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Filter a list of `{ url }` items, keeping only direct video links and
 * returning each one's video ID. Stable, deduped, max `limit` items.
 */
export function extractYouTubeIds(
  items: ReadonlyArray<{ url: string }> | undefined,
  limit?: number,
): string[] {
  if (!items?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const id = extractYouTubeId(item.url);
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
      if (limit && out.length >= limit) break;
    }
  }
  return out;
}
