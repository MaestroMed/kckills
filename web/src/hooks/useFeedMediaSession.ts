"use client";

/**
 * useFeedMediaSession — lockscreen presence + screen wake for the
 * scroll feed (Vague 6, audit 2026-07-05).
 *
 * Two modern-web upgrades the audit flagged as fully absent:
 *
 * 1. MediaSession API — the active clip's matchup + thumbnail show up
 *    on the OS media surface (lockscreen, control center, smartwatch)
 *    with native prev/next controls driving the feed. This is table
 *    stakes for a video PWA and free engagement (the KC logo art on a
 *    lockscreen is brand surface).
 *
 * 2. Screen Wake Lock — a viewer watching a clip chain without
 *    touching the screen no longer gets interrupted by auto-lock.
 *    Re-acquired on visibilitychange (the lock is released by the OS
 *    whenever the tab hides — per spec).
 *
 * Both feature-detect and no-op silently on unsupported browsers.
 */

import { useEffect, useRef } from "react";

interface ActiveClipMeta {
  id: string;
  title: string;
  artist: string;
  thumbnailUrl: string | null;
}

export function useFeedMediaSession(
  active: ActiveClipMeta | null,
  handlers: {
    onNext: () => void;
    onPrev: () => void;
  },
): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  // ── MediaSession metadata + transport controls ─────────────────────
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    if (!active) return;

    try {
      ms.metadata = new MediaMetadata({
        title: active.title,
        artist: active.artist,
        album: "KCKILLS",
        artwork: active.thumbnailUrl
          ? [{ src: active.thumbnailUrl, sizes: "720x1280", type: "image/jpeg" }]
          : [],
      });
      ms.setActionHandler("nexttrack", () => handlersRef.current.onNext());
      ms.setActionHandler("previoustrack", () => handlersRef.current.onPrev());
    } catch {
      /* older engines throw on unknown handlers — cosmetic feature */
    }
    return () => {
      try {
        ms.setActionHandler("nexttrack", null);
        ms.setActionHandler("previoustrack", null);
      } catch {
        /* ignore */
      }
    };
  }, [active?.id, active?.title, active?.artist, active?.thumbnailUrl, active]);

  // ── Screen Wake Lock while the feed is on screen ───────────────────
  useEffect(() => {
    type WakeLockSentinel = { release: () => Promise<void>; released?: boolean };
    const nav = navigator as Navigator & {
      wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> };
    };
    if (!nav.wakeLock) return;

    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;

    const acquire = async () => {
      if (disposed || document.visibilityState !== "visible") return;
      try {
        sentinel = await nav.wakeLock!.request("screen");
      } catch {
        /* low battery / permission — the OS knows best */
      }
    };
    const onVisibility = () => {
      // The UA auto-releases on hide; re-acquire when we come back.
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, []);
}
