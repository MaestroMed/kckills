"use client";

/**
 * useSwipeShare — left-swipe gesture detection wired to the share sheet.
 *
 * Detection thresholds (tuned for 375px mobile + 14ms ~= one frame):
 *   - movement.x must exceed SWIPE_DISTANCE_PX (80px) AND
 *   - elapsed time < SWIPE_DURATION_MS (300ms) AND
 *   - |dx| > 2.5 × |dy|  (the gesture is "mostly horizontal" — protects
 *     the vertical scroll which is the feed's primary axis)
 *
 * Direction:
 *   - dx < 0 → left swipe → trigger share
 *   - dx > 0 → right swipe → reserved for future "back" / "previous"
 *
 * Activation guard:
 *   - The gesture only fires when `enabled=true`. Parent should pass
 *     `enabled={isActive}` so the warm/cold pool slots can't accidentally
 *     trigger a share for the wrong kill.
 *
 * Wraps @use-gesture/react useDrag — the hook returns a bind() spreader
 * the parent attaches to the gesture surface (the central video area).
 *
 * Note: the gesture coexists with the parent's vertical scroll gesture
 * (useFeedGesture). useDrag's filterTaps + axis: undefined means the
 * library will track both axes, and we discriminate in onDragEnd. The
 * vertical gesture controller still owns the y-axis snap math because
 * its drag is registered on the OUTER container; this gesture is on an
 * INNER element with stopPropagation: false so events still bubble for
 * the vertical scroll.
 *
 * The share callback receives no arguments — the caller closes over the
 * killId / shareTitle / etc.
 */

import { useDrag } from "@use-gesture/react";

const SWIPE_DISTANCE_PX = 80;
const SWIPE_DURATION_MS = 300;
const HORIZONTAL_BIAS_RATIO = 2.5;

interface Options {
  enabled: boolean;
  onSwipeLeft: () => void;
}

export function useSwipeShare({ enabled, onSwipeLeft }: Options) {
  return useDrag(
    ({ movement: [mx, my], elapsedTime, last, tap }) => {
      if (!enabled) return;
      if (!last) return; // only act on release
      if (tap) return; // taps already handled by DoubleTapHeart
      if (elapsedTime > SWIPE_DURATION_MS) return;

      const absX = Math.abs(mx);
      const absY = Math.abs(my);
      // Mostly-horizontal guard. If the user was scrolling the feed
      // (mostly vertical) we let it through to the parent gesture.
      if (absX < HORIZONTAL_BIAS_RATIO * absY) return;
      if (absX < SWIPE_DISTANCE_PX) return;

      // Left swipe only. Right is reserved for a future back / previous
      // gesture so we don't burn the affordance now.
      if (mx >= 0) return;

      onSwipeLeft();
    },
    {
      // Don't lock to a single axis — we need to compare X vs Y to
      // detect "mostly horizontal". The parent vertical scroll gesture
      // uses a separate useGesture instance on the OUTER container.
      filterTaps: true,
      // Larger threshold than the vertical scroll's 6px so accidental
      // taps don't trigger a share. The full SWIPE_DISTANCE_PX is
      // checked in onDragEnd anyway — this just stops React from
      // running the handler on micro-movements.
      threshold: 12,
      // Don't preventDefault — we want events to also reach the parent
      // vertical scroll controller in case the user actually meant to
      // scroll vertically but the gesture started ambiguously.
      eventOptions: { passive: true },
    },
  );
}
