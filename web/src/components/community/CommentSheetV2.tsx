"use client";

/**
 * CommentSheetV2 — TikTok-grade bottom sheet for comments.
 *
 * Replaces the v1 CommentPanel which had a thin touch-detect
 * "drag-to-dismiss" hack. This one uses framer-motion's drag with
 * spring-back, dismissOnVelocity, and proper rubber-band at top.
 *
 * Layout:
 *   - 90vh height (TikTok ~85% of viewport, leaves a peek of the clip)
 *   - Drag handle at top — drag down to dismiss, drag up rubber-bands
 *   - Header: count + sort toggle (Latest / Top) + close button
 *   - Scrollable list (replies threaded inline, max depth 3)
 *   - Sticky input at bottom (sends on Enter or button click)
 *
 * Behaviour:
 *   - Optimistic POST: comment appears INSTANTLY on submit, replaced
 *     by server's canonical row when response lands
 *   - 401 → onAuthRequired callback (parent shows InlineAuthPrompt)
 *   - 4xx/5xx → rollback + inline error toast
 *   - Idempotent: opening multiple times re-fetches with AbortController
 *   - keyboard: Escape closes, Enter submits (if not in textarea)
 *
 * Wave 7 (Agent AF) additions:
 *   - Per-comment up/down vote buttons (CommentVote) with optimistic UI
 *     and 401 → onAuthRequired flow shared with the comment composer.
 *   - Sort toggle: Latest (default) / Top — Top uses Wilson lower-bound
 *     confidence-based sort (lib/comments.ts → commentWilsonScore()).
 *
 * Server contract: GET /api/kills/[id]/comment returns comments enriched
 * with `upvotes`, `downvote_count`, `user_vote`. POST returns the
 * inserted row with profile joined.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence, useMotionValue } from "motion/react";
import { ReportButton } from "./ReportButton";
import { CommentVote } from "./CommentVote";
import { CommentSortToggle } from "./CommentSortToggle";
import { sortComments, type CommentSortMode } from "@/lib/comments";

interface ApiProfile {
  id?: string;
  discord_username?: string | null;
  discord_avatar_url?: string | null;
  username?: string | null; // legacy
}

interface ApiComment {
  id: string;
  content?: string | null;
  body?: string | null; // legacy
  created_at?: string | null;
  parent_id?: string | null;
  profile?: ApiProfile | null;
  replies?: ApiComment[];
  moderation_status?: string | null;
  // Wave 7 additions — see /api/kills/[id]/comment GET enrichment
  upvotes?: number | null;
  downvote_count?: number | null;
  user_vote?: number | null;
}

interface UiComment {
  id: string;
  user: string;
  avatar?: string;
  text: string;
  time: string;
  createdAtMs: number;
  pending?: boolean;
  modPending?: boolean;
  replies?: UiComment[];
  // Vote state (defaults to 0/0/0 when the server omits the fields, e.g.
  // for optimistic rows we just inserted client-side).
  upvotes: number;
  downvoteCount: number;
  userVote: -1 | 0 | 1;
}

interface Props {
  killId: string;
  isOpen: boolean;
  onClose: () => void;
  onAuthRequired?: () => void;
}

// Threshold (px) past which a release closes the sheet. < 80px = bounce back.
const DISMISS_THRESHOLD = 120;
const DISMISS_VELOCITY = 500; // px/sec — fast flick down also closes


export function CommentSheetV2({ killId, isOpen, onClose, onAuthRequired }: Props) {
  const [comments, setComments] = useState<UiComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [postText, setPostText] = useState("");
  const [posting, setPosting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [sortMode, setSortMode] = useState<CommentSortMode>("latest");
  const errorTimerRef = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const y = useMotionValue(0);

  // Reset y on open so previous drag offset doesn't persist
  useEffect(() => {
    if (isOpen) y.set(0);
  }, [isOpen, y]);

  // Close on Esc
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  // Load comments on open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setErrorMsg(null);
    const ac = new AbortController();
    fetch(`/api/kills/${killId}/comment`, { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown) => {
        if (ac.signal.aborted) return;
        const mapped = Array.isArray(data) ? (data as ApiComment[]).map(toUi) : [];
        setComments(mapped);
        setLoading(false);
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        setLoading(false);
        setErrorMsg("Impossible de charger les commentaires");
      });
    return () => ac.abort();
  }, [killId, isOpen]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (errorTimerRef.current != null) window.clearTimeout(errorTimerRef.current);
  }, []);

  const flashError = useCallback((msg: string) => {
    setErrorMsg(msg);
    if (errorTimerRef.current != null) window.clearTimeout(errorTimerRef.current);
    errorTimerRef.current = window.setTimeout(() => setErrorMsg(null), 4000);
  }, []);

  const submit = useCallback(async () => {
    if (posting) return;
    const trimmed = postText.trim();
    if (!trimmed) return;

    // Optimistic insert
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: UiComment = {
      id: optimisticId,
      user: "Toi",
      text: trimmed,
      time: "maintenant",
      createdAtMs: Date.now(),
      pending: true,
      upvotes: 0,
      downvoteCount: 0,
      userVote: 0,
    };
    setComments((prev) => [optimistic, ...prev]);
    setPostText("");
    setPosting(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`/api/kills/${killId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.status === 401) {
        // Rollback + auth prompt
        setComments((prev) => prev.filter((c) => c.id !== optimisticId));
        setPostText(trimmed);
        onAuthRequired?.();
        return;
      }
      if (!res.ok) {
        let serverMsg: string | null = null;
        try {
          const j = (await res.json()) as { error?: string };
          serverMsg = j.error ?? null;
        } catch {
          // ignore parse failure
        }
        setComments((prev) => prev.filter((c) => c.id !== optimisticId));
        setPostText(trimmed);
        flashError(serverMsg ?? "Erreur du serveur");
        return;
      }
      const data: ApiComment = await res.json();
      const real = toUi(data);
      // Replace optimistic with canonical
      setComments((prev) => prev.map((c) => (c.id === optimisticId ? real : c)));
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== optimisticId));
      setPostText(trimmed);
      flashError("Probleme reseau");
    } finally {
      setPosting(false);
    }
  }, [killId, posting, postText, onAuthRequired, flashError]);

  /** Update vote state for a single comment (top-level OR reply) without
   *  re-fetching. The CommentVote children call this on successful POST. */
  const handleVoteChange = useCallback(
    (commentId: string, state: { upvotes: number; downvotes: number; userVote: -1 | 0 | 1 }) => {
      setComments((prev) =>
        prev.map((c) =>
          c.id === commentId
            ? { ...c, upvotes: state.upvotes, downvoteCount: state.downvotes, userVote: state.userVote }
            : c.replies
              ? {
                  ...c,
                  replies: c.replies.map((r) =>
                    r.id === commentId
                      ? { ...r, upvotes: state.upvotes, downvoteCount: state.downvotes, userVote: state.userVote }
                      : r,
                  ),
                }
              : c,
        ),
      );
    },
    [],
  );

  const totalComments = comments.reduce(
    (acc, c) => acc + 1 + (c.replies?.length ?? 0),
    0,
  );

  // Apply the current sort mode. Pending comments always stay at the top
  // (sortComments() handles that internally). Replies inside each thread
  // remain in their server order — we don't re-sort the inner list.
  const sortedComments = useMemo(
    () => sortComments(comments, sortMode),
    [comments, sortMode],
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[300]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {/* Backdrop */}
          <motion.div
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          />

          {/* Sheet */}
          <motion.div
            className="absolute bottom-0 left-0 right-0 flex flex-col rounded-t-3xl bg-[var(--bg-surface)] border-t border-[var(--gold)]/25 shadow-[0_-30px_80px_rgba(0,0,0,0.65)]"
            style={{ height: "90vh", y }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 32 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > DISMISS_THRESHOLD || info.velocity.y > DISMISS_VELOCITY) {
                onClose();
              }
            }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-2 cursor-grab active:cursor-grabbing">
              <div className="h-1.5 w-11 rounded-full bg-white/25" />
            </div>

            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-5 pb-3 border-b border-white/5">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-white leading-none">
                  Commentaires
                </h3>
                <p className="font-data text-[10px] uppercase tracking-widest text-white/45 mt-1">
                  {totalComments} {totalComments <= 1 ? "message" : "messages"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CommentSortToggle mode={sortMode} onChange={setSortMode} />
                <button
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/8 hover:bg-white/15 transition-colors"
                  aria-label="Fermer"
                >
                  <svg className="h-4 w-4 text-white/75" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Comments list */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {loading ? (
                <CommentSkeletons />
              ) : sortedComments.length === 0 ? (
                <EmptyState />
              ) : (
                sortedComments.map((c) => (
                  <CommentRow
                    key={c.id}
                    comment={c}
                    depth={0}
                    onAuthRequired={onAuthRequired}
                    onVoteChange={handleVoteChange}
                  />
                ))
              )}
            </div>

            {/* Sticky composer */}
            <div className="border-t border-white/5 bg-[var(--bg-surface)]/95 backdrop-blur-md">
              {errorMsg && (
                <p
                  role="status"
                  aria-live="polite"
                  className="px-5 pt-2 text-[11px] text-[var(--red)] flex items-center gap-1"
                >
                  <span>{"\u26A0"}</span>
                  {errorMsg}
                </p>
              )}
              <div
                className="flex gap-2 px-5 py-3"
                style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom, 0.75rem))" }}
              >
                <input
                  ref={inputRef}
                  type="text"
                  value={postText}
                  onChange={(e) => setPostText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !posting) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Ajoute un commentaire…"
                  maxLength={500}
                  disabled={posting}
                  className="flex-1 rounded-full bg-white/8 border border-white/10 px-4 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--gold)]/55 focus:bg-white/12 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={submit}
                  disabled={!postText.trim() || posting}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[var(--gold)] text-black font-bold transition-transform active:scale-90 disabled:opacity-30 disabled:scale-100"
                  aria-label="Envoyer"
                >
                  {posting ? (
                    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="50 100" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 12l14-7-7 14-2-5-5-2z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── CommentRow (recursive for replies) ────────────────────────────────

const MAX_DEPTH = 3;

interface RowProps {
  comment: UiComment;
  depth: number;
  onAuthRequired?: () => void;
  onVoteChange: (commentId: string, state: { upvotes: number; downvotes: number; userVote: -1 | 0 | 1 }) => void;
}

function CommentRow({ comment, depth, onAuthRequired, onVoteChange }: RowProps) {
  const indent = Math.min(depth, MAX_DEPTH);
  // Optimistic + pending comments don't have a real server id yet —
  // skip the report + vote buttons so we don't POST against `opt-…` ids.
  const isLocalId =
    comment.pending ||
    comment.id.startsWith("opt-") ||
    comment.id.startsWith("local-");
  const reportable = !isLocalId;
  const votable = !isLocalId && !comment.modPending;

  return (
    <div style={{ marginLeft: indent > 0 ? `${indent * 14}px` : 0 }}>
      <div
        className={`flex gap-3 transition-opacity ${comment.pending ? "opacity-60" : ""}`}
      >
        <Avatar user={comment.user} avatar={comment.avatar} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-[13px] font-semibold text-white truncate">
              {comment.user}
            </span>
            <span className="text-[10px] text-white/40">{comment.time}</span>
            {comment.pending && (
              <span className="text-[9px] text-[var(--gold)]/70 italic">envoi…</span>
            )}
            {comment.modPending && (
              <span className="rounded-full bg-[var(--gold)]/15 border border-[var(--gold)]/30 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-[var(--gold)]">
                modération
              </span>
            )}
          </div>
          <p
            className={`text-[14px] mt-1 leading-snug break-words ${
              comment.modPending ? "text-white/40 italic" : "text-white/85"
            }`}
          >
            {comment.text}
          </p>
          {votable && (
            <div className="mt-1.5">
              <CommentVote
                commentId={comment.id}
                initialUpvotes={comment.upvotes}
                initialDownvotes={comment.downvoteCount}
                initialUserVote={comment.userVote}
                onAuthRequired={onAuthRequired}
                onChange={(state) => onVoteChange(comment.id, state)}
              />
            </div>
          )}
        </div>
        {reportable && (
          <ReportButton
            targetType="comment"
            targetId={comment.id}
            size="sm"
            className="self-start mt-0.5"
          />
        )}
      </div>
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-3 border-l border-white/8 pl-3">
          {comment.replies.map((r) => (
            <CommentRow
              key={r.id}
              comment={r}
              depth={depth + 1}
              onAuthRequired={onAuthRequired}
              onVoteChange={onVoteChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar({ user, avatar }: { user: string; avatar?: string }) {
  if (avatar) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={avatar} alt="" className="h-9 w-9 rounded-full flex-shrink-0 object-cover" />;
  }
  return (
    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-xs font-bold text-[var(--gold)]">
      {user[0]?.toUpperCase() ?? "?"}
    </div>
  );
}

function CommentSkeletons() {
  return (
    <div className="space-y-4">
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex gap-3 animate-pulse">
          <div className="h-9 w-9 rounded-full bg-white/8 flex-shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-3 w-24 rounded bg-white/8" />
            <div className="h-3 w-full rounded bg-white/5" />
            <div className="h-3 w-3/4 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="text-4xl mb-3 opacity-50">{"\uD83D\uDCAC"}</div>
      <p className="font-display text-base font-bold text-white/85">
        Aucun commentaire
      </p>
      <p className="text-[12px] text-white/45 mt-1 max-w-xs">
        Sois le premier à réagir. C'est plus fun à plusieurs.
      </p>
    </div>
  );
}

// ─── Mappers ──────────────────────────────────────────────────────────

function toUi(c: ApiComment): UiComment {
  const createdAtMs = c.created_at ? new Date(c.created_at).getTime() : Date.now();
  const userVoteRaw = c.user_vote;
  const userVote: -1 | 0 | 1 =
    userVoteRaw === -1 || userVoteRaw === 1 ? userVoteRaw : 0;
  return {
    id: String(c.id ?? ""),
    user: String(c.profile?.discord_username ?? c.profile?.username ?? "Anonyme"),
    avatar: c.profile?.discord_avatar_url ?? undefined,
    text: String(c.content ?? c.body ?? ""),
    time: c.created_at ? formatTimeAgo(c.created_at) : "",
    createdAtMs,
    modPending: c.moderation_status === "pending",
    upvotes: typeof c.upvotes === "number" ? c.upvotes : 0,
    downvoteCount: typeof c.downvote_count === "number" ? c.downvote_count : 0,
    userVote,
    replies: Array.isArray(c.replies) ? c.replies.map(toUi) : undefined,
  };
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return "à l'instant";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 604800) return `${Math.floor(s / 86400)} j`;
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
