"use client";

/**
 * CommentVote — Reddit-style up/down arrow + score display.
 *
 * Optimistic update :
 *   * Click → set local state immediately, fire POST in the background.
 *   * On 401 → revert local state + call onAuthRequired (parent shows
 *     the InlineAuthPrompt or the login link).
 *   * On any other failure → revert local state + flash a short error.
 *
 * Anonymous mode : when `isAuthenticated === false` the buttons render
 * disabled with a tooltip "Connecte-toi pour voter". Clicking still
 * triggers `onAuthRequired` so the parent can surface the login flow.
 *
 * Mobile : tap targets are 32px minimum (the SVG arrow + a 6px halo).
 * Score collapses to icon-only on screens narrower than 360px (the
 * "small screen" breakpoint per the task spec).
 *
 * Server contract :
 *   POST /api/comments/[id]/vote { vote: -1 | 0 | 1 }
 *   → { upvotes, downvotes, userVote }
 *
 *   "vote = 0" = remove the user's existing vote (DELETE the row).
 */

import { useCallback, useRef, useState } from "react";
import { track } from "@/lib/analytics/track";
import { voteOnComment } from "./actions";

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
  onChange?: (state: {
    upvotes: number;
    downvotes: number;
    userVote: -1 | 0 | 1;
  }) => void;
  className?: string;
}

// 🎯 Wave 13b — migrated from `fetch('/api/comments/[id]/vote')` to a
// Server Action (`voteOnComment` in ./actions). The legacy VoteResponse
// shape was kept until the rollout was verified ; the action returns a
// proper discriminated union instead so the optimistic-revert path is
// type-safe.

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
  const [upvotes, setUpvotes] = useState(initialUpvotes);
  const [downvotes, setDownvotes] = useState(initialDownvotes);
  const [userVote, setUserVote] = useState<-1 | 0 | 1>(initialUserVote);
  const [busy, setBusy] = useState(false);
  /** Latest request id — older responses are ignored if a newer click landed. */
  const requestIdRef = useRef(0);

  const submit = useCallback(
    async (target: -1 | 1) => {
      if (busy) return;
      if (!isAuthenticated) {
        onAuthRequired?.();
        return;
      }

      // Reddit-style toggle :
      //   * click the arrow you already used → vote = 0 (remove)
      //   * click the opposite arrow         → vote = target (flip)
      const nextVote: -1 | 0 | 1 = userVote === target ? 0 : target;

      // Compute the optimistic delta on the score column.
      //   userVote=0  → upvotes ± 1
      //   userVote=±1 → upvotes ± 2 (the flip cancels old vote AND adds new)
      const scoreDelta = nextVote - userVote;
      const downvoteDelta =
        (nextVote === -1 ? 1 : 0) - (userVote === -1 ? 1 : 0);

      // Snapshot for rollback.
      const prevUpvotes = upvotes;
      const prevDownvotes = downvotes;
      const prevUserVote = userVote;

      setUpvotes((v) => v + scoreDelta);
      setDownvotes((v) => v + downvoteDelta);
      setUserVote(nextVote);
      setBusy(true);

      const reqId = ++requestIdRef.current;

      try {
        const result = await voteOnComment(commentId, nextVote);

        // Stale response — a newer click already landed.
        if (reqId !== requestIdRef.current) return;

        if (!result.ok) {
          setUpvotes(prevUpvotes);
          setDownvotes(prevDownvotes);
          setUserVote(prevUserVote);
          if (result.authRequired) onAuthRequired?.();
          return;
        }

        // Reconcile against the server's canonical numbers — protects
        // against optimistic-vs-server drift on rapid re-votes.
        setUpvotes(result.upvotes);
        setDownvotes(result.downvotes);
        setUserVote(result.userVote);

        onChange?.({
          upvotes: result.upvotes,
          downvotes: result.downvotes,
          userVote: result.userVote,
        });

        // Best-effort analytics ping. Whitelisted in migration 038 +
        // /api/track ALLOWED_EVENT_TYPES + track.ts EventType union.
        track("comment.voted", {
          entityType: "comment",
          entityId: commentId,
          metadata: { vote: result.userVote, prev: prevUserVote },
        });
      } catch {
        if (reqId !== requestIdRef.current) return;
        setUpvotes(prevUpvotes);
        setDownvotes(prevDownvotes);
        setUserVote(prevUserVote);
      } finally {
        if (reqId === requestIdRef.current) setBusy(false);
      }
    },
    [busy, isAuthenticated, userVote, upvotes, downvotes, commentId, onAuthRequired, onChange],
  );

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
        disabled={busy && !upActive}
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
        disabled={busy && !downActive}
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
