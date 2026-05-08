/**
 * liked-cache — V9 (Wave 22.2).
 *
 * Tiny localStorage cache of `kill_id → liked-at-ms`. Fed by
 * `LikeButton` on every successful rate / unrate, read by every
 * subsequent mount of the button so the heart shows pre-filled
 * INSTANTLY before the server round-trip.
 *
 * Two reasons it exists :
 *
 *   1. Authed visitors get a perceptually-instant like state on
 *      page refresh (the server-side `ratings` row is the truth,
 *      but the client doesn't have to wait for the 60-150 ms
 *      round-trip just to render the heart).
 *
 *   2. Anonymous visitors get a session-local ledger of "what I
 *      tapped". The server forbids anonymous ratings via RLS, so
 *      the optimistic state was previously lost on next mount.
 *      The cache makes "I clicked the heart on this clip" persist
 *      across navigations within the same browser.
 *
 * Storage shape : `{ ids: { [killId]: timestamp_ms } }`. Bounded at
 * 500 entries — older ones are evicted by FIFO (Map iteration
 * order = insertion order in modern engines).
 *
 * Key versioned for safe future schema bumps.
 */

const STORAGE_KEY = "kc_liked_cache_v1";
const MAX_ENTRIES = 500;

interface LikedCache {
  ids: Record<string, number>;
}

const EMPTY: LikedCache = { ids: {} };

function read(): LikedCache {
  if (typeof window === "undefined") return EMPTY;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<LikedCache>;
    if (parsed && typeof parsed.ids === "object") {
      return { ids: parsed.ids as Record<string, number> };
    }
    return EMPTY;
  } catch {
    return EMPTY;
  }
}

function write(cache: LikedCache) {
  if (typeof window === "undefined") return;
  try {
    // Cap at MAX_ENTRIES by FIFO trimming. We sort by timestamp
    // ASC and drop the oldest when over budget.
    let ids = cache.ids;
    const keys = Object.keys(ids);
    if (keys.length > MAX_ENTRIES) {
      const sorted = keys.sort((a, b) => ids[a] - ids[b]);
      const drop = sorted.slice(0, keys.length - MAX_ENTRIES);
      ids = { ...ids };
      for (const k of drop) delete ids[k];
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ ids }));
    window.dispatchEvent(new CustomEvent("kc:liked-cache-changed"));
  } catch {
    /* quota / disabled */
  }
}

/** Returns true if the user has tapped the heart on this kill in
 *  the local cache. Client-only ; SSR returns false. */
export function isLocallyLiked(killId: string): boolean {
  if (typeof window === "undefined") return false;
  const c = read();
  return killId in c.ids;
}

/** Add a kill to the cache. Idempotent. */
export function rememberLiked(killId: string) {
  const c = read();
  if (killId in c.ids) {
    c.ids[killId] = Date.now(); // refresh timestamp
  } else {
    c.ids[killId] = Date.now();
  }
  write(c);
}

/** Remove a kill from the cache (user unliked). */
export function forgetLiked(killId: string) {
  const c = read();
  if (killId in c.ids) {
    delete c.ids[killId];
    write(c);
  }
}

/** Returns the full liked-id Set for any consumer that wants to
 *  filter / count locally. Returns an empty Set on SSR. */
export function getLocallyLikedSet(): Set<string> {
  if (typeof window === "undefined") return new Set();
  return new Set(Object.keys(read().ids));
}
