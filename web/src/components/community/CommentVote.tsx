"use client";

/**
 * CommentVote — Reddit-style up/down arrow + score display.
 *
 * Optimistic update (React 19 useOptimistic) :
 *   * Click → `addOptimistic({ vote })` flips the UI in the same tick.
 *   * The Server Action (`voteOnComment`) runs inside startTransition.
 *   * On error / 401, useOptimistic auto-reverts to the last server
 *     state we committed via setServerState — no manual snapshot dance.
 *
 * Anonymous mode : when `isAuthenticated === false` the buttons render
 * disabled with a tooltip "Connecte-toi pour voter". Clicking still
 * triggers `onAuthRequired` so the parent can surface the login flow.
 *
 * Mobile : tap targets are 32px minimum (the SVG arrow + a 6px halo).
 * Score collapses to icon-only on screens narrower than 360px (the
 * "small screen" breakpoint per the task spec).
 */

import { useCallback, useOptimistic, useState, useTransition } from "react";
import { track } from "@/lib/analytics/track";
import { voteOnComment } from "./actions";

interface VoteState {
  upvotes: number;
  downvotes: number;
  userVote: -1 | 0 | 1;
}

interface Props {
  commentId: string;
  initialUpvotes: number;
  initialDownvotes: number;
  initialUserVote: -1 | 0 | 1;
  /** When the parent KNOWS the user is anonymous (no session cookie),
   *  pass false to render the buttons in their disabled state with a
   *  "Connecte-toi pour voter" tooltip. Default `true` lets the click
   *  go through and the server's 401 trigger onAuthRequired — same
   *  lazy pattern as LikeButton. */
  isAuthenticated?: boolean;
  onAuthRequired?: () => void;
  /** Notify the parent so it can keep its own derived state (e.g. the
   *  Wilson-sorted list) in sync without a refetch. Called with the
   *  new (upvotes, downvotes, userVote) tuple after a successful POST. */
  onChange?: (state: VoteState) => void;
  className?: string;
}

export function CommentVote({
  commentId,
  initialUpvotes,
  initialDownvotes,
  initialUserVote,
  isAuthenticated = true,
  onAuthRequired,
  onChange,
  className,
}: Props) {
  // The "truth" we commit after each successful Server Action — useOptimistic
  // automatically falls back to this whenever a transition finishes (success
  // or error). React 19 handles the snapshot/revert under the hood.
  const [serverState, setServerState] = useState<VoteState>({
    upvotes: initialUpvotes,
    downvotes: initialDownvotes,
    userVote: initialUserVote,
  });

  const [optimisticState, addOptimistic] = useOptimistic(
    serverState,
    (current, nextVote: -1 | 0 | 1) => {
      // Compute the optimistic delta on the score columns.
      //   userVote=0  → upvotes ± 1
      //   userVote=±1 → upvotes ± 2 (the flip cancels old vote AND adds new)
      const scoreDelta = nextVote - current.userVote;
      const downvoteDelta =
        (nextVote === -1 ? 1 : 0) - (current.userVote === -1 ? 1 : 0);
      return {
        upvotes: current.upvotes + scoreDelta,
        downvotes: current.downvotes + downvoteDelta,
        userVote: nextVote,
      };
    },
  );

  const [isPending, startTransition] = useTransition();

  const submit = useCallback(
    (target: -1 | 1) => {
      if (isPending) return;
      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }

      // Reddit-style toggle :
      //   * click the arrow you already used → vote = 0 (remove)
      //   * click the opposite arrow         → vote = target (flip)
      const nextVote: -1 | 0 | 1 =
        serverState.userVote === target ? 0 : target;
      const prevVote = serverState.userVote;

      startTransition(async () => {
        addOptimistic(nextVote);

        const result = await voteOnComment(commentId, nextVote);

        if (!result.ok) {
          // useOptimistic auto-reverts to serverState — no manual rollback.
          if (result.authRequired) onAuthRequired?.();
          return;
        }

        // Reconcile against the server's canonical numbers — protects
        // against optimistic-vs-server drift on rapid re-votes.
        const next: VoteState = {
          upvotes: result.upvotes,
          downvotes: result.downvotes,
          userVote: result.userVote,
        };
        setServerState(next);
        onChange?.(next);

        // Best-effort analytics ping. Whitelisted in migration 038 +
        // /api/track ALLOWED_EVENT_TYPES + track.ts EventType union.
        track("comment.voted", {
          entityType: "comment",
          entityId: commentId,
          metadata: { vote: result.userVote, prev: prevVote },
        });
      });
    },
    [
      isPending,
      isAuthenticated,
      serverState.userVote,
      commentId,
      addOptimistic,
      onAuthRequired,
      onChange,
    ],
  );

  const { upvotes, downvotes, userVote } = optimisticState;
  const upActive = userVote === 1;
  const downActive = userVote === -1;
  const disabled = !isAuthenticated;
  const tooltip = disabled ? "Connecte-toi pour voter" : undefined;

  return (
    <div
      className={`inline-flex items-center gap-0.5 ${className ?? ""}`}
      role="group"
      aria-label="Voter sur ce commentaire"
    >
      <button
        type="button"
        onClick={() => submit(1)}
        disabled={isPending && !upActive}
        aria-label={upActive ? "Retirer le vote positif" : "Voter positivement"}
        aria-pressed={upActive}
        title={tooltip}
        className={`
          flex h-8 w-8 items-center justify-center rounded-full
          transition-colors transition-transform
          ${upActive
            ? "bg-[var(--gold)]/20 text-[var(--gold)]"
            : "text-white/55 hover:bg-white/10 hover:text-white/85"}
          ${disabled ? "opacity-50 cursor-not-allowed" : "active:scale-90"}
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]/60
        `.replace(/\s+/g, " ").trim()}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      <span
        className={`
          font-data text-[12px] tabular-nums min-w-[1.5ch] text-center
          ${upActive ? "text-[var(--gold)]" : downActive ? "text-[var(--red)]" : "text-white/65"}
          ${upvotes === 0 && downvotes === 0 ? "hidden xs:inline" : ""}
        `.replace(/\s+/g, " ").trim()}
        aria-label={`Score : ${upvotes}, ${downvotes} vote${downvotes > 1 ? "s" : ""} négatif${downvotes > 1 ? "s" : ""}`}
      >
        {formatScore(upvotes)}
      </span>

      <button
        type="button"
        onClick={() => submit(-1)}
        disabled={isPending && !downActive}
        aria-label={downActive ? "Retirer le vote négatif" : "Voter négativement"}
        aria-pressed={downActive}
        title={tooltip}
        className={`
          flex h-8 w-8 items-center justify-center rounded-full
          transition-colors transition-transform
          ${downActive
            ? "bg-[var(--red)]/20 text-[var(--red)]"
            : "text-white/55 hover:bg-white/10 hover:text-white/85"}
          ${disabled ? "opacity-50 cursor-not-allowed" : "active:scale-90"}
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--red)]/60
        `.replace(/\s+/g, " ").trim()}
      >
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
    </div>
  );
}

/** Compact display: 1.2k, 12k, 1.4M. Matches what /scroll uses on like counts. */
function formatScore(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}k`;
  return `${n}`;
}
