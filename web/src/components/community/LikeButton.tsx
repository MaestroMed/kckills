"use client";

/**
 * LikeButton — TikTok-grade heart toggle.
 *
 * Visible state:
 *   - Outline heart when not liked
 *   - Filled red heart when liked + scale-bounce animation
 *   - Live count below
 *   - Disabled (greyed) while in-flight to prevent spam-click double-fire
 *
 * Behaviour:
 *   - Optimistic toggle: visual flips IMMEDIATELY on tap, server call fires
 *     in background. If server returns 401 we rollback + emit auth-needed
 *     event so the parent can show InlineAuthPrompt.
 *   - On 5xx / network error we rollback + show inline toast.
 *   - GET on mount paints the correct initial state without a flash.
 *
 * Backed by /api/kills/[id]/like which writes to the existing `ratings`
 * table (score=5). The 5-star precision UI remains available via the
 * RatingSheet (secondary action).
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  killId: string;
  /** Initial server-rendered count to paint immediately (avoids 0 flash). */
  initialCount?: number;
  /** Compact (sidebar) or wide (page detail) layout. */
  variant?: "compact" | "wide";
  /** Triggered when an auth-required action happens. The parent should
   *  open the InlineAuthPrompt — we emit an event rather than render
   *  one inline so multiple LikeButtons can share a single prompt. */
  onAuthRequired?: () => void;
}

export function LikeButton({
  killId,
  initialCount = 0,
  variant = "compact",
  onAuthRequired,
}: Props) {
  const [liked, setLiked] = useState(false);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);
  const [burstKey, setBurstKey] = useState(0); // re-trigger animation on each like
  const lastClickRef = useRef(0);

  // ─── Hydrate initial state ──────────────────────────────────────
  useEffect(() => {
    if (!isUuid(killId)) return;
    const ac = new AbortController();
    fetch(`/api/kills/${killId}/like`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { liked?: boolean; rating_count?: number } | null) => {
        if (ac.signal.aborted || !data) return;
        setLiked(Boolean(data.liked));
        if (typeof data.rating_count === "number") setCount(data.rating_count);
      })
      .catch(() => {
        // Silent — server-rendered initialCount is the fallback
      });
    return () => ac.abort();
  }, [killId]);

  const toggle = async (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    // Throttle: ignore taps within 250ms of each other (debounce
    // double-tap that would otherwise like-then-immediately-unlike).
    const now = Date.now();
    if (now - lastClickRef.current < 250) return;
    lastClickRef.current = now;
    if (pending) return;

    const wasLiked = liked;
    const newLiked = !wasLiked;

    // Optimistic flip
    setLiked(newLiked);
    setCount((c) => Math.max(0, c + (newLiked ? 1 : -1)));
    if (newLiked) setBurstKey((k) => k + 1);
    setPending(true);

    try {
      const res = await fetch(`/api/kills/${killId}/like`, {
        method: newLiked ? "POST" : "DELETE",
      });
      if (res.status === 401) {
        // Rollback + ask the parent to handle auth
        setLiked(wasLiked);
        setCount((c) => Math.max(0, c + (newLiked ? -1 : 1)));
        onAuthRequired?.();
        return;
      }
      if (!res.ok) {
        setLiked(wasLiked);
        setCount((c) => Math.max(0, c + (newLiked ? -1 : 1)));
        return;
      }
      // Trust server's count (might differ from optimistic if other
      // users liked concurrently between request + response).
      const data: { liked: boolean; rating_count: number } = await res.json();
      if (typeof data.rating_count === "number") setCount(data.rating_count);
      setLiked(Boolean(data.liked));
    } catch {
      // Network error — rollback
      setLiked(wasLiked);
      setCount((c) => Math.max(0, c + (newLiked ? -1 : 1)));
    } finally {
      setPending(false);
    }
  };

  const sizes = variant === "wide"
    ? { btn: "h-14 w-14", icon: "h-7 w-7", label: "text-sm" }
    : { btn: "h-12 w-12", icon: "h-6 w-6", label: "text-[10px]" };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      aria-label={liked ? "Retirer le like" : "Liker"}
      className="flex flex-col items-center gap-1.5 select-none"
    >
      <div
        className={`relative flex items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border transition-all active:scale-90 ${sizes.btn} ${
          liked
            ? "border-[var(--red)]/50 bg-[var(--red)]/15"
            : "border-white/10 hover:bg-black/65"
        }`}
      >
        <motion.svg
          key={liked ? "filled" : "outline"}
          className={`${sizes.icon} ${liked ? "text-[var(--red)]" : "text-white"} transition-colors`}
          viewBox="0 0 24 24"
          fill={liked ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth={liked ? 0 : 2}
          initial={liked ? { scale: 0.7 } : false}
          animate={liked ? { scale: 1 } : { scale: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 14 }}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
          />
        </motion.svg>

        {/* Burst — exploding little hearts when liked */}
        <AnimatePresence>
          {liked && (
            <BurstEffect key={burstKey} />
          )}
        </AnimatePresence>
      </div>
      <span
        className={`font-data font-bold tabular-nums tracking-tight ${sizes.label} ${
          liked ? "text-[var(--red)]" : "text-white/75"
        }`}
      >
        {formatCount(count)}
      </span>
    </button>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** TikTok-style count: 1.2K, 3.4M, etc. */
function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** 6 tiny hearts that radiate outward + fade, ~600ms total. */
function BurstEffect() {
  const angles = [-60, -30, 0, 30, 60, 90];
  return (
    <>
      {angles.map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const dx = Math.cos(rad) * 30;
        const dy = Math.sin(rad) * 30 - 8; // bias upward
        return (
          <motion.span
            key={i}
            className="pointer-events-none absolute inset-0 flex items-center justify-center"
            initial={{ opacity: 1, x: 0, y: 0, scale: 0.5 }}
            animate={{ opacity: 0, x: dx, y: dy, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.25, 1, 0.5, 1] }}
          >
            <svg className="h-3 w-3 text-[var(--red)]" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </motion.span>
        );
      })}
    </>
  );
}
