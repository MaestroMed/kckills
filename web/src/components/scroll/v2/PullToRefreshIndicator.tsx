"use client";

/**
 * PullToRefreshIndicator — rubber-band pull-down at the TOP of the
 * feed that re-shuffles when released past a threshold.
 *
 * Design choices that match TikTok:
 *   - Only triggers when activeIndex === 0 (you're already at the top)
 *   - Reads the SAME containerY motion value as the feed container,
 *     so the pull-down distance is real (no separate gesture controller)
 *   - Shows a 24px circular spinner that grows + rotates with the pull
 *   - At ~80px pull, locks into "release to refresh" state with haptic
 *   - On release past threshold, fires onRefresh(), animates back up
 *     while the parent re-shuffles, then snaps closed when the new feed
 *     mounts
 *
 * Important: this component RENDERS but doesn't OWN the gesture. The
 * parent's useFeedGesture is the source of truth for containerY. We
 * just observe it and translate ourselves accordingly.
 */

import { useEffect, useState } from "react";
import { motion, useMotionValueEvent, type MotionValue } from "framer-motion";

const PTR_THRESHOLD = 80;

interface Props {
  /** The container's translateY motion value. Positive = pulled down. */
  containerY: MotionValue<number>;
  /** Whether we're currently at the top of the feed (activeIndex === 0). */
  atTop: boolean;
  /** Triggered when user releases past threshold. Parent does the
   *  actual reshuffle / data swap. */
  onRefresh: () => void;
  /** True while the parent is busy re-shuffling. We freeze the
   *  spinner in active state until this turns false. */
  isRefreshing: boolean;
}

export function PullToRefreshIndicator({
  containerY,
  atTop,
  onRefresh,
  isRefreshing,
}: Props) {
  /** Current pull distance in px. 0 = idle, >0 = being pulled. */
  const [pullPx, setPullPx] = useState(0);
  /** Have we crossed the threshold this gesture? — controls colour
   *  + label switch from "Tirer" to "Lâcher pour mélanger". */
  const [armed, setArmed] = useState(false);
  /** Did we already fire onRefresh for this gesture? — prevents spam
   *  if containerY oscillates above threshold. */
  const [fired, setFired] = useState(false);

  // Subscribe to containerY changes. Only react when at the top —
  // pulling from the middle of the feed is a normal scroll-back.
  useMotionValueEvent(containerY, "change", (latest) => {
    if (!atTop) {
      if (pullPx !== 0) setPullPx(0);
      if (armed) setArmed(false);
      return;
    }
    // containerY > 0 means user has dragged the feed downward
    // (revealing space above the first item). Cap at 200px so we
    // don't translate the spinner off-screen on huge over-pulls.
    const px = Math.max(0, Math.min(200, latest));
    setPullPx(px);
    if (px >= PTR_THRESHOLD && !armed) {
      setArmed(true);
      // Haptic if available
      if ("vibrate" in navigator) navigator.vibrate(8);
    } else if (px < PTR_THRESHOLD && armed) {
      setArmed(false);
    }
  });

  // Detect release: pullPx drops back to 0 quickly. We watch armed
  // state across renders — if we WERE armed and now pullPx === 0 (or
  // close), fire onRefresh.
  useEffect(() => {
    if (!atTop) {
      setFired(false);
      return;
    }
    // Detection: armed is true AND pull is collapsing toward 0 (the
    // gesture ended). framer-motion will animate containerY back to 0,
    // so we observe pullPx in the next change event and trigger when
    // we're armed but pullPx falls below 30 (mid-collapse).
    if (armed && !fired && pullPx > 0 && pullPx < 30) {
      setFired(true);
      onRefresh();
    }
  }, [armed, pullPx, atTop, fired, onRefresh]);

  // Reset fired flag when refresh completes.
  useEffect(() => {
    if (!isRefreshing) {
      setFired(false);
    }
  }, [isRefreshing]);

  if (!atTop && pullPx === 0 && !isRefreshing) return null;

  const progress = Math.min(1, pullPx / PTR_THRESHOLD);
  const showSpinner = isRefreshing || pullPx > 5;

  return (
    <motion.div
      className="pointer-events-none fixed left-0 right-0 z-[55] flex flex-col items-center justify-center"
      style={{
        // Sits at the top of the viewport, translates DOWN with the pull.
        top: 0,
        height: "80px",
        y: isRefreshing ? 24 : Math.min(pullPx * 0.6, 60),
        opacity: showSpinner ? 1 : 0,
      }}
    >
      <div
        className="flex h-10 w-10 items-center justify-center rounded-full bg-black/70 backdrop-blur-md border border-white/10 shadow-lg"
        style={{
          borderColor: armed || isRefreshing ? "var(--gold)" : "rgba(255,255,255,0.15)",
          transform: `scale(${0.6 + progress * 0.4})`,
          transition: isRefreshing ? "transform 0.3s ease-out" : "none",
        }}
      >
        <svg
          className={`h-5 w-5 ${isRefreshing ? "animate-spin" : ""}`}
          style={{
            color: armed || isRefreshing ? "var(--gold)" : "rgba(255,255,255,0.6)",
            transform: !isRefreshing ? `rotate(${progress * 360}deg)` : undefined,
            transition: !isRefreshing ? "none" : undefined,
          }}
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
      </div>
      <p
        className="mt-2 font-data text-[9px] uppercase tracking-widest"
        style={{ color: armed || isRefreshing ? "var(--gold)" : "rgba(255,255,255,0.5)" }}
      >
        {isRefreshing
          ? "Mélange..."
          : armed
            ? "Lâcher pour mélanger"
            : pullPx > 5
              ? "Tirer"
              : ""}
      </p>
    </motion.div>
  );
}
