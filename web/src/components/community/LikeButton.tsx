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
 * Behaviour (React 19 useOptimistic):
 *   - Optimistic toggle: visual flips IMMEDIATELY on tap, Server Action
 *     fires inside startTransition. On error / 401 useOptimistic
 *     auto-reverts to the last server-confirmed state — no manual
 *     rollback / no captured pre-flip snapshot.
 *   - Initial state hydrated via the `getKillLikeState` Server Action so
 *     the heart paints correctly without a flash of wrong state.
 *
 * Backed by the `toggleKillLike` Server Action (`./actions`) which writes
 * to the existing `ratings` table (score=5). The 5-star precision UI
 * remains available via the RatingSheet (secondary action).
 */

import {
  useCallback,
  useEffect,
  useOptimistic,
  useRef,
  useState,
  useTransition,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { toggleKillLike, getKillLikeState } from "./actions";

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

interface LikeState {
  liked: boolean;
  count: number;
}

export function LikeButton({
  killId,
  initialCount = 0,
  variant = "compact",
  onAuthRequired,
}: Props) {
  // V9 (Wave 22.2) — hydrate the OPTIMISTIC initial state from the
  // localStorage liked-cache so the heart shows pre-filled instantly
  // on mount (before the server round-trip resolves the truth). For
  // anonymous visitors the cache IS the persistence ; for authed
  // visitors it's just a perceptually-snappier render.
  const [serverState, setServerState] = useState<LikeState>(() => {
    let liked = false;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem("kc_liked_cache_v1");
        if (raw) {
          const parsed = JSON.parse(raw) as { ids?: Record<string, number> };
          liked = !!(parsed?.ids && killId in parsed.ids);
        }
      } catch {
        /* corrupted JSON — silent */
      }
    }
    return { liked, count: initialCount };
  });
  const [optimisticState, addOptimistic] = useOptimistic(
    serverState,
    (current, nextLiked: boolean) => ({
      liked: nextLiked,
      count: Math.max(0, current.count + (nextLiked ? 1 : -1)),
    }),
  );
  const [isPending, startTransition] = useTransition();
  const [burstKey, setBurstKey] = useState(0); // re-trigger animation on each like
  const lastClickRef = useRef(0);

  // ─── Hydrate initial state ──────────────────────────────────────
  useEffect(() => {
    if (!isUuid(killId)) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getKillLikeState(killId);
        if (cancelled) return;
        setServerState({ liked: data.liked, count: data.ratingCount });
      } catch {
        // Silent — server-rendered initialCount is the fallback
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [killId]);

  /** Toggle the like. Wrapped in useCallback so the DoubleTapHeart
   *  listener below can use it without TDZ + without re-binding the
   *  listener on every render. */
  const toggle = useCallback(
    (
      e: React.MouseEvent | React.TouchEvent | { stopPropagation: () => void },
      options?: { forceLike?: boolean },
    ) => {
      e.stopPropagation();
      // Throttle: ignore taps within 250ms of each other (debounce
      // double-tap that would otherwise like-then-immediately-unlike).
      const now = Date.now();
      if (now - lastClickRef.current < 250) return;
      lastClickRef.current = now;
      if (isPending) return;

      const wasLiked = serverState.liked;
      // forceLike (used by DoubleTapHeart) never unlikes — TikTok behavior:
      // double-tap on already-liked re-fires the burst but stays liked.
      if (options?.forceLike && wasLiked) {
        setBurstKey((k) => k + 1);
        return;
      }
      const newLiked = options?.forceLike ? true : !wasLiked;

      if (newLiked) setBurstKey((k) => k + 1);

      startTransition(async () => {
        addOptimistic(newLiked);
        try {
          const result = await toggleKillLike(killId, newLiked);
          if (!result.ok) {
            // useOptimistic auto-reverts to serverState — no manual rollback.
            if (result.authRequired) onAuthRequired?.();
            return;
          }
          // Trust server's count (might differ from optimistic if other
          // users liked concurrently between request + response).
          setServerState({ liked: result.liked, count: result.ratingCount });
          // V9 — sync the localStorage liked-cache so subsequent
          // mounts of this kill (other ScrollFeed renders, /kill/[id]
          // detail page, ClipReel cards) show the heart filled in.
          try {
            const raw = window.localStorage.getItem("kc_liked_cache_v1");
            const parsed = raw ? JSON.parse(raw) : { ids: {} };
            const ids = (parsed.ids ?? {}) as Record<string, number>;
            if (result.liked) {
              ids[killId] = Date.now();
            } else {
              delete ids[killId];
            }
            window.localStorage.setItem(
              "kc_liked_cache_v1",
              JSON.stringify({ ids }),
            );
          } catch {
            /* quota / disabled — silent, server is still source-of-truth */
          }
        } catch {
          // Network error — useOptimistic auto-reverts.
        }
      });
    },
    [killId, isPending, serverState.liked, onAuthRequired, addOptimistic],
  );

  // ─── Listen for DoubleTapHeart (kc:double-tap-like) ────────────
  useEffect(() => {
    if (!isUuid(killId)) return;
    const onDoubleTap = (e: Event) => {
      const detail = (e as CustomEvent<{ killId?: string }>).detail;
      if (!detail || detail.killId !== killId) return;
      toggle({ stopPropagation: () => {} }, { forceLike: true });
    };
    window.addEventListener("kc:double-tap-like", onDoubleTap);
    return () =>
      window.removeEventListener("kc:double-tap-like", onDoubleTap);
  }, [killId, toggle]);

  const { liked, count } = optimisticState;
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
