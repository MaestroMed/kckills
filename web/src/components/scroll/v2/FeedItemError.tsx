"use client";

/**
 * FeedItemError — fallback shown when a video fails to load (R2 404,
 * network error, decode error). Replaces the broken FeedItem in-place.
 *
 * UX rules (TikTok parity):
 *   - Show a friendly French message with an icon
 *   - Offer a "Réessayer" button that re-mounts the parent (parent
 *     bumps a key, the pool re-attaches the video src)
 *   - Auto-skip to the next clip after AUTO_SKIP_MS if the user
 *     doesn't tap. TikTok's behavior is to advance silently rather
 *     than block the user on a stuck clip.
 *   - Fire `clip.error` analytics ONCE per mount with the kill_id +
 *     error_code reported by the <video onError> handler.
 *
 * Accessibility:
 *   - role="alert" so AT users hear the failure
 *   - The Retry button is the focused element by default → keyboard
 *     users can hit Enter immediately
 *   - Auto-skip is suppressed when prefers-reduced-motion is true so
 *     keyboard / screen reader users have time to read + react
 */

import { useEffect, useRef } from "react";
import { track } from "@/lib/analytics/track";

interface Props {
  killId: string;
  /** Pixel height matching the parent's itemHeight (snap-anchor parity). */
  itemHeight: number;
  /** Free-form code from the <video onError> handler — usually one of
   *  "MEDIA_ERR_NETWORK", "MEDIA_ERR_DECODE", "MEDIA_ERR_SRC_NOT_SUPPORTED",
   *  or our own "404" / "fetch_failed". Surfaced in analytics for triage. */
  errorCode?: string | null;
  /** Triggered when the user taps "Réessayer" — parent should bump a
   *  key on FeedItem so the pool re-attaches the source. */
  onRetry: () => void;
  /** Triggered when AUTO_SKIP_MS elapses without a retry tap. Parent
   *  advances activeIndex by 1 (jumpTo). NOT fired if prefers-
   *  reduced-motion is true — see effect below. */
  onAutoSkip?: () => void;
  /** Whether this item is currently the active (visible) one. We only
   *  fire analytics + start the auto-skip timer for the active item;
   *  preloaded warm/cold neighbours stay quiet. */
  isActive: boolean;
}

const AUTO_SKIP_MS = 3000;

export function FeedItemError({
  killId,
  itemHeight,
  errorCode,
  onRetry,
  onAutoSkip,
  isActive,
}: Props) {
  const firedRef = useRef(false);

  // Fire analytics ONCE per mount when this becomes the active item.
  useEffect(() => {
    if (!isActive || firedRef.current) return;
    firedRef.current = true;
    track("clip.error", {
      entityType: "kill",
      entityId: killId,
      metadata: { error_code: errorCode ?? "unknown" },
    });
  }, [isActive, killId, errorCode]);

  // Auto-skip after 3s of inactivity. Disabled under prefers-reduced-motion
  // so users with motion sensitivity / keyboard navigation aren't rushed.
  useEffect(() => {
    if (!isActive || !onAutoSkip) return;
    if (typeof window === "undefined") return;
    let prefersReduced = false;
    try {
      prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      /* matchMedia missing — assume motion is fine */
    }
    if (prefersReduced) return;

    const timer = window.setTimeout(() => {
      onAutoSkip();
    }, AUTO_SKIP_MS);
    return () => window.clearTimeout(timer);
  }, [isActive, onAutoSkip]);

  return (
    <div
      data-feed-error
      role="alert"
      aria-live="assertive"
      style={{ height: `${itemHeight}px` }}
      className="relative flex w-full flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[var(--bg-primary)] via-[#0a1428] to-[var(--bg-primary)] px-6"
    >
      {/* Hextech ambient — same as EndOfFeedCard so the failure
          surface still feels on-brand. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(232,64,87,0.10), transparent 60%)",
        }}
      />

      <div className="relative z-10 flex flex-col items-center max-w-xs text-center">
        {/* Icon — broken-circle warning */}
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--red)]/15 border border-[var(--red)]/40">
          <svg
            aria-hidden
            className="h-8 w-8 text-[var(--red)]"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        <h2 className="font-display text-lg font-bold text-white mb-2">
          Ce clip est temporairement indisponible
        </h2>
        <p className="font-data text-[10px] uppercase tracking-widest text-white/45 mb-6">
          {errorCode ? `Code: ${errorCode}` : "Erreur de lecture"}
        </p>

        <button
          type="button"
          autoFocus
          onClick={(e) => {
            e.stopPropagation();
            firedRef.current = false; // allow re-fire if it errors again
            onRetry();
          }}
          className="inline-flex items-center gap-2 rounded-2xl bg-[var(--gold)] px-6 py-3 font-display text-sm font-black uppercase tracking-widest text-[var(--bg-primary)] transition-all hover:bg-[var(--gold-bright)] hover:shadow-2xl hover:shadow-[var(--gold)]/30 active:scale-95"
          aria-label="Réessayer le chargement du clip"
        >
          <svg
            aria-hidden
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2.5}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Réessayer
        </button>

        {/* Auto-skip hint — only show when isActive AND not under
            reduced-motion (the timer is suppressed in that case). */}
        {isActive && (
          <p className="mt-4 font-data text-[10px] text-white/35 motion-reduce:hidden">
            Passage automatique au prochain clip dans 3 s
          </p>
        )}
      </div>
    </div>
  );
}
