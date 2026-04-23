"use client";

/**
 * useImpressionTracker — fire-and-forget impression beacon.
 *
 * Calls POST /api/kills/[id]/impression once per (kill, session) when
 * a clip is "really watched" — defined as: active in the viewport for
 * more than DWELL_MS continuous milliseconds. This filters out:
 *   - flick-pasts where the user scrolls fast through 5 clips/sec
 *   - mistaken activations (IntersectionObserver fluctuation)
 *
 * Per-session dedup: a Set of already-reported kill IDs lives in the
 * module scope so the same clip isn't double-counted on swipe-back-
 * swipe-forward within the same page load.
 *
 * Used by the FeedPlayerPool / FeedItem to track real engagement.
 * Backed by the SQL function `fn_record_impression(p_kill_id UUID)`
 * (migration 001) which does an O(1) UPDATE.
 *
 * Why client-side beacon vs server-side impression on RSC render:
 *   - We only count VIEWED clips, not RENDERED ones (a clip can be
 *     in the DOM but never reached visually thanks to virtualization)
 *   - SSR impressions would inflate counts on bots, prefetch, etc.
 */

import { useEffect, useRef } from "react";

const DWELL_MS = 1500;

/** Module-scope dedup set — survives across hook instances within
 *  the same page load. Reset on navigation (hook unmount + remount). */
const reportedThisSession = new Set<string>();

export function useImpressionTracker({
  killId,
  isActive,
}: {
  killId: string | null | undefined;
  isActive: boolean;
}) {
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Clean up any pending timer when active state changes.
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    if (!isActive || !killId) return;
    if (reportedThisSession.has(killId)) return;

    // UUID guard — aggregate items have non-UUID ids that would 400.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(killId)) {
      return;
    }

    timerRef.current = window.setTimeout(() => {
      reportedThisSession.add(killId);
      // Use sendBeacon if available — survives page unload (user scrolls,
      // navigates away, etc). Falls back to fetch with keepalive.
      const url = `/api/kills/${killId}/impression`;
      try {
        if ("sendBeacon" in navigator) {
          // sendBeacon needs a Blob payload; an empty Blob is fine.
          navigator.sendBeacon(url, new Blob([], { type: "application/json" }));
        } else {
          fetch(url, { method: "POST", keepalive: true }).catch(() => {});
        }
      } catch {
        // network or sandbox error — silent, impression is best-effort
      }
    }, DWELL_MS);

    return () => {
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [killId, isActive]);
}
