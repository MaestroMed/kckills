/**
 * Shared spring physics constants for the TikTok-native scroll feed.
 *
 * These values were tuned to match TikTok's native iOS feel — slightly
 * snappier than Reels (which feels heavier), looser than the default
 * scroll-snap CSS (which feels sterile / mechanical).
 *
 * Used by:
 *   - FeedViewport snap animation (post-release drag)
 *   - PullToRefreshIndicator rubber-band
 *   - End-of-feed card entrance
 *
 * Don't tune these without testing on a real iPhone — emulator gives
 * misleading results because the touch event timing is different.
 */

import type { ValueAnimationTransition } from "framer-motion";

/** The default snap. Used when releasing a normal swipe. */
export const SPRING_SNAP: ValueAnimationTransition = {
  type: "spring",
  stiffness: 320,
  damping: 32,
  mass: 0.85,
  restDelta: 0.5,
};

/** A faster, tighter spring for fast flicks (high-velocity releases). */
export const SPRING_FLICK: ValueAnimationTransition = {
  type: "spring",
  stiffness: 480,
  damping: 38,
  mass: 0.7,
  restDelta: 0.5,
};

/** Soft spring used by pull-to-refresh — feels rubber-band-y. */
export const SPRING_RUBBER: ValueAnimationTransition = {
  type: "spring",
  stiffness: 220,
  damping: 26,
  mass: 1.0,
};

/** Distance threshold (in fraction of viewport height) below which a
 *  release does NOT advance to the next clip — bounces back to current.
 *  TikTok's threshold is ~25% of screen height. */
export const SNAP_DISTANCE_FRACTION = 0.22;

/** Velocity threshold (px/ms) above which a release counts as a flick
 *  even if the distance hasn't passed SNAP_DISTANCE_FRACTION. */
export const FLICK_VELOCITY_THRESHOLD = 0.55;

/** Velocity above this triggers a multi-step skip (advance by 2). */
export const FAST_FLICK_VELOCITY = 1.6;
