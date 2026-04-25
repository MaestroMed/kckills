"use client";

/**
 * useScrollRestore — persist + restore the user's last-viewed kill in
 * /scroll across back-navigation from /kill/[id].
 *
 * Strategy:
 *   - On every snap commit (parent passes the active item id to
 *     persist()), write { id, ts } to sessionStorage.
 *   - On mount, read the stored value. If `ts` is < EXPIRY_MS old AND
 *     the stored kill id appears in the current `items` array, return
 *     its index so the parent can jumpTo() it instantly. Otherwise
 *     return null (no restore — initial deep-link logic still wins).
 *   - The 30-min expiry prevents stale restores after the user steps
 *     away from the tab for a long time. Reaches the same UX as the
 *     spec: "back from /kill/[id]" works, "open the tab tomorrow"
 *     starts fresh.
 *
 * sessionStorage (vs localStorage) because:
 *   - Restore should NOT cross tabs (each tab is its own browsing
 *     context, restoring a sibling tab's position would be jarring).
 *   - Cleared automatically when the tab closes — no stale-tomb
 *     debugging. The 30-min expiry is a belt + braces in case
 *     sessionStorage outlives a single browsing session in some
 *     vendor-specific edge case (e.g. iOS Safari reopening "your
 *     last tabs").
 *
 * The fired analytic `feed.scroll_restored` includes restored_index
 * so we can measure how often the feature actually saves a position.
 */

import { useEffect, useMemo } from "react";
import { track } from "@/lib/analytics/track";

const STORAGE_KEY = "scroll_v2_last_kill_id";
const EXPIRY_MS = 30 * 60 * 1000;

interface StoredEntry {
  id: string;
  ts: number;
}

function readStored(): StoredEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredEntry>;
    if (typeof parsed?.id !== "string" || typeof parsed?.ts !== "number") return null;
    if (Date.now() - parsed.ts > EXPIRY_MS) {
      // Expired — clean up.
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      return null;
    }
    return { id: parsed.id, ts: parsed.ts };
  } catch {
    return null;
  }
}

interface Options {
  /** All visible items (id-bearing entries). Used to resolve the stored
   *  id back to an index. Pass an empty array on the very first SSR
   *  pre-hydration render — the hook short-circuits gracefully. */
  items: { id: string }[];
  /** When true, the parent has its own deep-link source-of-truth (e.g.
   *  ?kill=<id>) and the restore should NOT override it. */
  hasDeepLink: boolean;
}

interface Result {
  /** Index of the stored kill in the current items[] array, or null if
   *  no valid restore is available. Stable across renders for the same
   *  inputs (memoized). */
  restoreIndex: number | null;
  /** Call from the parent on every snap commit to persist the new
   *  position. Pass null/undefined to clear (e.g. after the very last
   *  item is reached). */
  persist: (killId: string | null | undefined) => void;
}

export function useScrollRestore({ items, hasDeepLink }: Options): Result {
  // Read once on mount — sessionStorage values don't change reactively
  // during a session beyond what we ourselves write.
  const stored = useMemo(() => readStored(), []);

  const restoreIndex = useMemo<number | null>(() => {
    if (hasDeepLink) return null;
    if (!stored) return null;
    if (items.length === 0) return null;
    const idx = items.findIndex((it) => it.id === stored.id);
    return idx >= 0 ? idx : null;
  }, [stored, items, hasDeepLink]);

  // Fire analytics ONCE per mount when a real restore happens. We
  // gate on restoreIndex being non-null AND the parent not having a
  // deep-link override.
  useEffect(() => {
    if (restoreIndex == null || hasDeepLink) return;
    track("feed.scroll_restored", {
      metadata: { restored_index: restoreIndex, age_ms: stored ? Date.now() - stored.ts : null },
    });
    // Run once on first valid restore — items / restoreIndex are stable
    // for that match.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreIndex]);

  const persist = (killId: string | null | undefined): void => {
    if (typeof window === "undefined") return;
    try {
      if (!killId) {
        window.sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      const entry: StoredEntry = { id: killId, ts: Date.now() };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
    } catch {
      /* sessionStorage blocked (private mode, sandboxed) — silent */
    }
  };

  return { restoreIndex, persist };
}
