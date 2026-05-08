"use client";

/**
 * useFeedGesture — touch + mouse wheel + keyboard driver for the
 * TikTok-native feed. Replaces the v1 CSS scroll-snap-mandatory model
 * with a finger-tracking controller that springs to snap on release.
 *
 * Why drop scroll-snap CSS?
 *   - It snaps INSTANTLY (no spring, no overshoot)
 *   - It can't react to release velocity (no flick-skip-2)
 *   - It can't keep the pool's translate3d in lockstep with the drag
 *   - On iOS Safari it sometimes mis-snaps when the keyboard appears
 *
 * What this hook owns:
 *   - The container's translateY value (a framer-motion `MotionValue`)
 *   - The "current index" anchor (which item is at the top of viewport)
 *   - Drag detection (touch + mouse), wheel handling, keyboard arrows
 *   - Spring animation on release (snap to nearest, or skip on flick)
 *
 * What it returns:
 *   - bind            : props to spread on the viewport (`@use-gesture`)
 *   - y               : MotionValue<number> — the translateY in px
 *   - activeIndex     : currently snapped index (drives pool + URL)
 *   - jumpTo(index)   : programmatic snap (used by ?kill=<id> deep link)
 *
 * Math model:
 *   y = -(activeIndex * itemHeight) + dragDelta
 *   At rest, dragDelta = 0 and y = -(activeIndex * itemHeight).
 *   During drag, dragDelta is updated each frame.
 *   On release we compute targetIndex from y + velocity, animate y to
 *   -(targetIndex * itemHeight), then commit setActiveIndex(targetIndex).
 */

import { useGesture } from "@use-gesture/react";
import { animate, useMotionValue } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FAST_FLICK_VELOCITY,
  FLICK_VELOCITY_THRESHOLD,
  SNAP_DISTANCE_FRACTION,
  SPRING_FLICK,
  SPRING_SNAP,
} from "@/lib/scroll/spring";

interface Options {
  totalItems: number;
  itemHeight: number;
  /** Initial index to position at on mount (e.g. from ?kill=<id>). */
  initialIndex?: number;
  /** Called once per snap commit so the parent can update URL state etc. */
  onActiveChange?: (index: number) => void;
  /** Disables all gesture handling (e.g. while a sheet is open). */
  enabled?: boolean;
}

interface Result {
  /** Attach to the gesture-receiving container via {...bind()} */
  bind: ReturnType<typeof useGesture>;
  /** MotionValue carrying the current translateY in px. Wire to a
   *  motion.div with style={{ y }}. The pool reads it via useMotionValueEvent
   *  to keep its videos in lockstep with the drag. */
  y: ReturnType<typeof useMotionValue<number>>;
  /** Last committed index (post-snap). Different from "what's visually
   *  closest to centre during a drag" — only updates on snap commit. */
  activeIndex: number;
  /** Programmatic snap. Used by deep-link initial scroll + keyboard nav. */
  jumpTo: (index: number, opts?: { instant?: boolean }) => void;
  /** Triggered by parent when we want to disable gestures (e.g. modal). */
  setEnabled: (v: boolean) => void;
  /** Whether we're currently in the middle of a drag — used by the
   *  parent to suppress tap-to-pause / link clicks during a swipe. */
  isDragging: boolean;
}

export function useFeedGesture({
  totalItems,
  itemHeight,
  initialIndex = 0,
  onActiveChange,
  enabled: enabledProp = true,
}: Options): Result {
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [isDragging, setIsDragging] = useState(false);
  const [enabled, setEnabled] = useState(enabledProp);
  useEffect(() => setEnabled(enabledProp), [enabledProp]);

  const y = useMotionValue(-initialIndex * itemHeight);

  /** Stable ref to the latest activeIndex / itemHeight so gesture
   *  callbacks (closure-captured) read live values without re-binding. */
  const stateRef = useRef({ activeIndex, itemHeight, totalItems, enabled });
  stateRef.current = { activeIndex, itemHeight, totalItems, enabled };

  /** Internal: commit a target index — animates y, then setState. */
  const animateToIndex = useCallback(
    (target: number, useFlickSpring: boolean) => {
      const clamped = Math.max(0, Math.min(stateRef.current.totalItems - 1, target));
      const targetY = -clamped * stateRef.current.itemHeight;
      animate(y, targetY, useFlickSpring ? SPRING_FLICK : SPRING_SNAP);
      if (clamped !== stateRef.current.activeIndex) {
        setActiveIndex(clamped);
        // V5 (Wave 21.1) — light haptic feedback on snap commit. Only
        // fires when the index actually changes (not on bounce-back),
        // and only on devices with the API (Android Chrome, some iOS
        // PWA builds). The vibration spec is conservative — 8 ms is
        // imperceptible on broken implementations and feels right on
        // good ones. iOS Safari mostly ignores it (no native haptic
        // API exposed to the web), so iPhone users get the visual
        // spring snap as their feedback.
        try {
          if (
            typeof navigator !== "undefined" &&
            typeof navigator.vibrate === "function"
          ) {
            navigator.vibrate(useFlickSpring ? 12 : 8);
          }
        } catch {
          /* navigator.vibrate may throw on unsupported scenarios */
        }
        onActiveChange?.(clamped);
      }
    },
    [y, onActiveChange],
  );

  /** Re-anchor y when the viewport size changes (rotation, etc). */
  useEffect(() => {
    if (itemHeight > 0) {
      y.set(-activeIndex * itemHeight);
    }
  }, [itemHeight, activeIndex, y]);

  // ─── Drag (touch + mouse) ────────────────────────────────────────
  const bind = useGesture(
    {
      onDragStart: () => {
        if (!stateRef.current.enabled) return;
        setIsDragging(true);
      },
      onDrag: ({ movement: [, my], cancel }) => {
        if (!stateRef.current.enabled) {
          cancel?.();
          return;
        }
        const { activeIndex, itemHeight, totalItems } = stateRef.current;
        const baseY = -activeIndex * itemHeight;
        let nextY = baseY + my;
        // Edge resistance — drag past first/last item gets rubber-banded.
        const minY = -(totalItems - 1) * itemHeight;
        const maxY = 0;
        if (nextY > maxY) nextY = maxY + (nextY - maxY) * 0.35;
        if (nextY < minY) nextY = minY + (nextY - minY) * 0.35;
        y.set(nextY);
      },
      onDragEnd: ({ movement: [, my], velocity: [, vy], direction: [, dy] }) => {
        if (!stateRef.current.enabled) return;
        setIsDragging(false);
        const { activeIndex, itemHeight } = stateRef.current;
        const absVelocity = Math.abs(vy);
        const absMovement = Math.abs(my);
        const distanceFraction = absMovement / itemHeight;

        // Decide target index from drag distance + release velocity.
        let target = activeIndex;
        let useFlickSpring = false;

        if (absVelocity >= FAST_FLICK_VELOCITY) {
          // Fast flick: skip 2 in the direction of release.
          target = activeIndex + (dy < 0 ? 2 : -2);
          useFlickSpring = true;
        } else if (
          absVelocity >= FLICK_VELOCITY_THRESHOLD ||
          distanceFraction >= SNAP_DISTANCE_FRACTION
        ) {
          // Normal flick OR distance past snap threshold: advance by 1.
          target = activeIndex + (dy < 0 ? 1 : -1);
          useFlickSpring = absVelocity >= FLICK_VELOCITY_THRESHOLD;
        }

        animateToIndex(target, useFlickSpring);
      },
      // ─── Mouse wheel — same controller, scaled deltaY ────────────
      onWheel: ({ event, delta: [, deltaY], direction: [, dirY], last }) => {
        if (!stateRef.current.enabled) return;
        // Only trap vertical scroll; let horizontal pass to the browser.
        event.preventDefault();
        // We treat each wheel "tick" as a discrete navigation, NOT a
        // continuous drag — most desktop wheels emit 100px-ish per tick.
        // Debounce: only act on the first frame of a tick burst.
        if (!last && Math.abs(deltaY) > 12) {
          const { activeIndex } = stateRef.current;
          animateToIndex(activeIndex + (dirY > 0 ? 1 : -1), false);
        }
      },
    },
    {
      drag: {
        // Y-axis only. X swipes are reserved for future horizontal nav.
        axis: "y",
        // Activation threshold so a tap doesn't get caught as a drag.
        threshold: 6,
        // Filter out pointer events that come from buttons / links.
        filterTaps: true,
        // Track velocity precisely.
        rubberband: false,
        // Capture at root so children's stopPropagation doesn't break us.
        eventOptions: { passive: false },
      },
      wheel: {
        // Apply our own throttling — leave use-gesture's default off.
        eventOptions: { passive: false },
      },
    },
  );

  const jumpTo = useCallback(
    (index: number, opts?: { instant?: boolean }) => {
      const clamped = Math.max(0, Math.min(stateRef.current.totalItems - 1, index));
      const targetY = -clamped * stateRef.current.itemHeight;
      if (opts?.instant) {
        y.set(targetY);
      } else {
        animate(y, targetY, SPRING_SNAP);
      }
      if (clamped !== stateRef.current.activeIndex) {
        setActiveIndex(clamped);
        onActiveChange?.(clamped);
      }
    },
    [y, onActiveChange],
  );

  return { bind, y, activeIndex, jumpTo, setEnabled, isDragging };
}
