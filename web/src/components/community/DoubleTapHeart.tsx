"use client";

/**
 * DoubleTapHeart — TikTok signature gesture: double-tap on the video
 * to like, big floating heart animation lands at the tap point.
 *
 * Usage: drop inside an absolutely-positioned container (the FeedItem
 * video overlay layer). The component itself renders nothing visible
 * until a double-tap fires — then a heart bursts from the tap location
 * and fades over ~700ms.
 *
 * The double-tap detection is custom (not browser-native dblclick)
 * because we need it to work on touch + work alongside the existing
 * single-tap-to-pause handler. Trick: on tap N, schedule a "single tap"
 * action with 250ms timeout. On tap N+1 within that window, cancel
 * the single tap + fire double-tap.
 *
 * Backed by a callback `onDoubleTap` so the parent can wire whatever
 * action it wants. In FeedItem we wire it to the LikeButton's like
 * action — the heart visual is just the gesture acknowledgement.
 */

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

interface Props {
  /** Triggered on a confirmed double-tap. The parent decides what
   *  the gesture means (usually: toggle ON the like). */
  onDoubleTap: () => void;
  /** Optional single-tap handler — fires after DOUBLE_TAP_WINDOW_MS
   *  if no second tap arrived. Used for tap-to-pause. */
  onSingleTap?: () => void;
  /** Called when an action requires auth — surfaces the inline prompt. */
  onAuthRequired?: () => void;
  /** Whether the user is currently liked — drives whether to fire
   *  another like (no-op double-tap on already-liked) or fire a new
   *  one. Optional — if not passed we always fire. */
  isLiked?: boolean;
}

const DOUBLE_TAP_WINDOW_MS = 280;

interface Burst {
  id: number;
  x: number;
  y: number;
}

export function DoubleTapHeart({
  onDoubleTap,
  onSingleTap,
  isLiked,
}: Props) {
  const [bursts, setBursts] = useState<Burst[]>([]);
  const lastTapRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const singleTapTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (singleTapTimerRef.current != null) {
      window.clearTimeout(singleTapTimerRef.current);
    }
  }, []);

  const handlePointer = (e: React.PointerEvent) => {
    // Ignore if the target is a button/link/input — those have their
    // own click semantics and we don't want to hijack.
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, [role='button']")) return;

    const now = Date.now();
    const pos = pointerPos(e);
    const last = lastTapRef.current;

    if (last && now - last.time < DOUBLE_TAP_WINDOW_MS) {
      // Double-tap detected. Cancel the pending single-tap.
      if (singleTapTimerRef.current != null) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      lastTapRef.current = null;
      // Fire the heart visual + onDoubleTap. Skip the visual if user
      // is already liked (we still fire the callback so the parent
      // can decide to no-op or unlike — but TikTok's behavior is
      // double-tap = always show the heart, never unlike).
      const burst: Burst = { id: now, x: pos.x, y: pos.y };
      setBursts((b) => [...b, burst]);
      window.setTimeout(() => {
        setBursts((b) => b.filter((x) => x.id !== burst.id));
      }, 800);
      onDoubleTap();
      return;
    }

    // First tap — schedule the single-tap action, save state for the
    // potential second tap.
    lastTapRef.current = { time: now, x: pos.x, y: pos.y };
    if (onSingleTap) {
      if (singleTapTimerRef.current != null) {
        window.clearTimeout(singleTapTimerRef.current);
      }
      singleTapTimerRef.current = window.setTimeout(() => {
        singleTapTimerRef.current = null;
        // Only fire single-tap if the SECOND tap never came.
        if (lastTapRef.current?.time === now) {
          lastTapRef.current = null;
          onSingleTap();
        }
      }, DOUBLE_TAP_WINDOW_MS);
    }
  };

  return (
    <>
      {/* Tap surface — covers the whole parent. pointer-events-auto so
          it captures, but z-0 so anything explicitly above (badges,
          right sidebar buttons) keeps its own clicks. */}
      <div
        className="absolute inset-0 z-[5]"
        style={{ pointerEvents: "auto", touchAction: "manipulation" }}
        onPointerDown={handlePointer}
        // Use suppressed dblclick to avoid a system-level dbltap that
        // would zoom the page on iOS Safari.
        onDoubleClick={(e) => e.preventDefault()}
      />

      {/* Floating hearts — render above everything */}
      <AnimatePresence>
        {bursts.map((b) => (
          <motion.div
            key={b.id}
            className="pointer-events-none absolute z-[20]"
            style={{ left: b.x, top: b.y }}
            initial={{ scale: 0.3, opacity: 0, x: "-50%", y: "-50%", rotate: -15 }}
            animate={{
              scale: [0.3, 1.4, 1.1, 1.0],
              opacity: [0, 1, 1, 0],
              y: ["-50%", "-60%", "-110%"],
              rotate: [-15, 8, -3, 0],
            }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{
              duration: 0.85,
              times: [0, 0.25, 0.6, 1],
              ease: "easeOut",
            }}
          >
            <svg
              className="h-32 w-32 text-[var(--red)] drop-shadow-[0_0_20px_rgba(232,64,87,0.7)]"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
            </svg>
          </motion.div>
        ))}
      </AnimatePresence>
    </>
  );
}

function pointerPos(e: React.PointerEvent): { x: number; y: number } {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
  return {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
}
