/**
 * comments.ts — shared types + Wilson sort helper for comment lists.
 *
 * Used by CommentSheetV2 (mobile sheet) and KillInteractions (detail page)
 * so the two surfaces stay in lockstep on sort behaviour.
 *
 * The Wilson lower-bound formula matches `feed-algorithm.ts` (which is
 * what CLAUDE.md §6.1 references for the scroll feed score). Reusing
 * `wilsonScore()` from there keeps a single source of truth — if we ever
 * tune the z-value (1.96 = 95% confidence) we change it in one place.
 */

import { wilsonScore } from "@/lib/feed-algorithm";

/** A comment's vote breakdown — what the API + UI reason about. */
export interface CommentVoteState {
  /** SUM(vote_value) = upvotes − downvotes (can be negative). Returned
   *  by the GET /api/kills/[id]/comment + POST vote endpoints. */
  upvotes: number;
  /** Count of -1 votes. Used by the Wilson denominator. */
  downvoteCount: number;
  /** The current user's own vote on this comment, 0 = no vote.
   *  Drives the active-state highlight on the up/down arrows. */
  userVote: -1 | 0 | 1;
}

/** Sort modes exposed by the toggle. Default is "latest" — Top is opt-in. */
export type CommentSortMode = "latest" | "top";

/**
 * Wilson lower-bound confidence interval for a (positive, total) split.
 *
 * For comment ranking we treat upvotes as positives and (upvotes +
 * downvotes) as the trial count. This rewards a 9/10 score over a 50/100
 * score even though both have the same raw ratio — small samples get
 * pulled toward 0.5 (the agnostic prior) until enough data accumulates.
 *
 * Edge cases :
 *   * Both 0 (no votes) → returns 0 → ranks at the bottom of "Top".
 *   * Negative `upvotes` (more downvotes than upvotes, our SUM convention)
 *     is clamped to 0 positives before the Wilson calc — formula assumes
 *     positives ≥ 0.
 */
export function commentWilsonScore(
  upvotes: number,
  downvoteCount: number,
): number {
  const positives = Math.max(0, upvotes + downvoteCount); // upvotes column = sum, so undo to recover positives
  const total = positives + downvoteCount;
  if (total <= 0) return 0;
  const phat = positives / total;
  return wilsonScore(phat, total);
}

/**
 * Sort a list of comments in place by the chosen mode.
 *
 * Returns a NEW array (so React state setters don't see a stable
 * reference and skip re-render). Comments with .pending = true always
 * stay at the top regardless of mode — they're optimistic posts the user
 * just made and we don't want to demote them as soon as they land.
 */
export function sortComments<T extends {
  pending?: boolean;
  upvotes?: number;
  downvoteCount?: number;
  createdAtMs?: number;
}>(items: readonly T[], mode: CommentSortMode): T[] {
  const pending = items.filter((c) => c.pending);
  const settled = items.filter((c) => !c.pending);

  if (mode === "top") {
    settled.sort((a, b) => {
      const sa = commentWilsonScore(a.upvotes ?? 0, a.downvoteCount ?? 0);
      const sb = commentWilsonScore(b.upvotes ?? 0, b.downvoteCount ?? 0);
      if (sb !== sa) return sb - sa;
      // Tiebreak: newer first (matches "latest" sub-order on equal Wilson)
      return (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0);
    });
  } else {
    settled.sort(
      (a, b) => (b.createdAtMs ?? 0) - (a.createdAtMs ?? 0),
    );
  }
  return [...pending, ...settled];
}
