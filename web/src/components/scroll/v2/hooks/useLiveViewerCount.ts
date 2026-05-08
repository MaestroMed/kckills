"use client";

/**
 * useLiveViewerCount — V17 (Wave 23.1).
 *
 * Tracks how many fans are currently watching the active match via
 * a Supabase Realtime presence channel. The key is `live-match-<id>` ;
 * each visitor joins on mount and the channel's `presenceState()`
 * gives the live count.
 *
 * Behaviour :
 *   * Returns `null` while not subscribed OR when no live match is
 *     active (the parent guards on `liveMatch.isLive`).
 *   * Number is throttled — we update at most every 2 s to avoid
 *     re-renders on every join/leave when the room is busy.
 *   * Falls back gracefully if Supabase Realtime is unreachable
 *     (firewall, browser extension blocking WebSockets) — returns
 *     null and logs a warning.
 *
 * Privacy : zero PII shared — just an anonymous "I'm here" signal.
 * The channel state lives entirely in Realtime's server, never
 * persisted. RLS doesn't apply (presence is ephemeral).
 *
 * Usage :
 *   const count = useLiveViewerCount(liveMatch.matchId);
 *   if (count != null && count > 1) <span>{count} regardent</span>
 */

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

const UPDATE_THROTTLE_MS = 2000;

export function useLiveViewerCount(
  matchId: string | null | undefined,
): number | null {
  const [count, setCount] = useState<number | null>(null);
  const lastUpdateRef = useRef(0);
  const pendingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!matchId) {
      setCount(null);
      return;
    }
    let cancelled = false;
    let channel: ReturnType<
      ReturnType<typeof createClient>["channel"]
    > | null = null;
    let throttleTimer: number | null = null;

    const flushPending = () => {
      if (pendingRef.current == null) return;
      const next = pendingRef.current;
      pendingRef.current = null;
      lastUpdateRef.current = Date.now();
      setCount(next);
    };

    const reportCount = (n: number) => {
      const now = Date.now();
      const sinceLast = now - lastUpdateRef.current;
      if (sinceLast >= UPDATE_THROTTLE_MS) {
        lastUpdateRef.current = now;
        setCount(n);
        return;
      }
      pendingRef.current = n;
      if (throttleTimer == null) {
        throttleTimer = window.setTimeout(() => {
          throttleTimer = null;
          flushPending();
        }, UPDATE_THROTTLE_MS - sinceLast);
      }
    };

    try {
      const sb = createClient();
      channel = sb.channel(`live-match-${matchId}`, {
        config: {
          presence: { key: cryptoRandomId() },
        },
      });
      channel
        .on("presence", { event: "sync" }, () => {
          if (cancelled || !channel) return;
          const state = channel.presenceState();
          // presenceState returns { [key]: PresenceMeta[] }. Total
          // viewers = sum of all presence-key entries (1 per device).
          const total = Object.values(state).reduce(
            (s: number, arr) => s + (Array.isArray(arr) ? arr.length : 0),
            0,
          );
          reportCount(total);
        })
        .subscribe((status: string) => {
          if (cancelled || !channel) return;
          if (status === "SUBSCRIBED") {
            void channel.track({ joined_at: Date.now() });
          }
        });
    } catch (e) {
      // Supabase unavailable, websocket blocked — silent.
      // eslint-disable-next-line no-console
      console.warn("[live-viewer-count] init failed", e);
    }

    return () => {
      cancelled = true;
      if (throttleTimer != null) window.clearTimeout(throttleTimer);
      if (channel) {
        try {
          void channel.unsubscribe();
        } catch {
          /* network may already be gone */
        }
      }
    };
  }, [matchId]);

  return count;
}

function cryptoRandomId(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const buf = new Uint8Array(8);
    crypto.getRandomValues(buf);
    return Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return Math.random().toString(36).slice(2, 18);
}
