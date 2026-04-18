"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { StarRating } from "@/components/star-rating";
import Link from "next/link";

// ─── Server-shape types ─────────────────────────────────────────────────
// Minimal interfaces matching what /api/kills/[id]/comment returns. Keeping
// them here (instead of as `Record<string, unknown>`) means a Supabase
// schema change yields a TS error instead of a silent runtime null cascade.

interface ApiProfile {
  id?: string;
  discord_username?: string | null;
  discord_avatar_url?: string | null;
  username?: string | null; // legacy field
}

interface ApiComment {
  id: string;
  content?: string | null;
  body?: string | null; // legacy field
  created_at?: string | null;
  parent_id?: string | null;
  profile?: ApiProfile | null;
  replies?: ApiComment[];
}

interface ApiRateResponse {
  avg_rating?: number | null;
  rating_count?: number | null;
  user_score?: number | null;
}

interface Comment {
  id: string;
  user: string;
  avatar?: string;
  text: string;
  time: string;
  replies?: Comment[];
  /** Optimistic local insert flag — turns the bubble subtly translucent
   *  while we wait for the server. Replaced when the server response
   *  arrives, or rolled back on failure. */
  pending?: boolean;
}

export function KillInteractions({ killId }: { killId: string }) {
  const [userRating, setUserRating] = useState(0);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [ratingCount, setRatingCount] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState<Comment[]>([]);
  const [loadingComments, setLoadingComments] = useState(true);
  const [authError, setAuthError] = useState(false);
  const [rateStatus, setRateStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [commentStatus, setCommentStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [commentError, setCommentError] = useState<string | null>(null);
  /** Guard against double-submit from spam Enter / spam click. */
  const submittingRef = useRef(false);
  /** Latest rate() request id — older responses are ignored if a newer
   *  click already landed. Prevents stale-response races. */
  const rateRequestIdRef = useRef(0);
  /** Track the auto-clear timer so we don't pile them up. */
  const rateStatusTimerRef = useRef<number | null>(null);
  const commentErrorTimerRef = useRef<number | null>(null);

  // UUID check — only call APIs for real Supabase kills (not legacy aggregate IDs)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(killId);

  // ─── Load comments on mount ──────────────────────────────────────────
  useEffect(() => {
    if (!isUuid) {
      setLoadingComments(false);
      return;
    }
    const ac = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/kills/${killId}/comment`, { signal: ac.signal });
        if (!res.ok) {
          setLoadingComments(false);
          return;
        }
        const data: unknown = await res.json();
        if (ac.signal.aborted) return;
        const mapComment = (c: ApiComment): Comment => ({
          id: String(c.id ?? ""),
          user: String(c.profile?.discord_username ?? c.profile?.username ?? "Anonyme"),
          avatar: c.profile?.discord_avatar_url ?? undefined,
          text: String(c.content ?? c.body ?? ""),
          time: c.created_at
            ? new Date(c.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })
            : "",
          replies: Array.isArray(c.replies) ? c.replies.map(mapComment) : undefined,
        });
        const mapped = Array.isArray(data) ? (data as ApiComment[]).map(mapComment) : [];
        setComments(mapped);
      } catch (err) {
        if ((err as { name?: string })?.name === "AbortError") return;
        // Supabase/schema error — degrade gracefully
      }
      if (!ac.signal.aborted) setLoadingComments(false);
    })();
    return () => ac.abort();
  }, [killId, isUuid]);

  // Cleanup timers on unmount
  useEffect(() => () => {
    if (rateStatusTimerRef.current != null) window.clearTimeout(rateStatusTimerRef.current);
    if (commentErrorTimerRef.current != null) window.clearTimeout(commentErrorTimerRef.current);
  }, []);

  // ─── Rate ────────────────────────────────────────────────────────────
  const handleRate = useCallback(async (score: number) => {
    setUserRating(score);
    if (!isUuid) return;
    setRateStatus("saving");
    // Bump request id and capture for staleness check.
    const reqId = ++rateRequestIdRef.current;
    if (rateStatusTimerRef.current != null) {
      window.clearTimeout(rateStatusTimerRef.current);
      rateStatusTimerRef.current = null;
    }
    try {
      const res = await fetch(`/api/kills/${killId}/rate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score }),
      });
      // Ignore stale response — a more recent click already landed.
      if (reqId !== rateRequestIdRef.current) return;
      if (res.status === 401) {
        setAuthError(true);
        setUserRating(0);
        setRateStatus("idle");
        return;
      }
      if (!res.ok) {
        setRateStatus("error");
        // Auto-clear after 3s so the UI doesn't stay stuck.
        rateStatusTimerRef.current = window.setTimeout(() => setRateStatus("idle"), 3000);
        return;
      }
      const data: ApiRateResponse = await res.json();
      if (reqId !== rateRequestIdRef.current) return;
      setAvgRating(typeof data.avg_rating === "number" ? data.avg_rating : null);
      setRatingCount(typeof data.rating_count === "number" ? data.rating_count : 0);
      setRateStatus("saved");
      rateStatusTimerRef.current = window.setTimeout(() => setRateStatus("idle"), 2000);
    } catch {
      if (reqId !== rateRequestIdRef.current) return;
      setRateStatus("error");
      rateStatusTimerRef.current = window.setTimeout(() => setRateStatus("idle"), 3000);
    }
  }, [killId, isUuid]);

  // ─── Comment ─────────────────────────────────────────────────────────
  const handleComment = useCallback(async () => {
    if (submittingRef.current) return; // double-submit guard
    const trimmed = commentText.trim();
    if (!trimmed) return;

    if (!isUuid) {
      // Local-only for legacy kills — instant insert, no server.
      setComments((prev) => [
        { id: `local-${Date.now()}`, user: "Toi", text: trimmed, time: "maintenant" },
        ...prev,
      ]);
      setCommentText("");
      return;
    }

    // ─── UUID kill: optimistic insert + rollback on failure ─────────
    submittingRef.current = true;
    setCommentStatus("submitting");
    if (commentErrorTimerRef.current != null) {
      window.clearTimeout(commentErrorTimerRef.current);
      commentErrorTimerRef.current = null;
    }
    setCommentError(null);
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: Comment = {
      id: optimisticId,
      user: "Toi",
      text: trimmed,
      time: "maintenant",
      pending: true,
    };
    setComments((prev) => [optimistic, ...prev]);
    setCommentText("");

    try {
      const res = await fetch(`/api/kills/${killId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      if (res.status === 401) {
        // Rollback + show login prompt — typed string for the user.
        setComments((prev) => prev.filter((c) => c.id !== optimisticId));
        setCommentText(trimmed);
        setAuthError(true);
        return;
      }
      if (!res.ok) {
        let serverMsg: string | null = null;
        try {
          const errJson = (await res.json()) as { error?: string };
          serverMsg = errJson.error ?? null;
        } catch {
          // ignore parse failure — fall back to generic
        }
        setComments((prev) => prev.filter((c) => c.id !== optimisticId));
        setCommentText(trimmed);
        setCommentStatus("error");
        setCommentError(serverMsg ?? "Erreur du serveur");
        commentErrorTimerRef.current = window.setTimeout(() => {
          setCommentStatus("idle");
          setCommentError(null);
        }, 4000);
        return;
      }
      const data: ApiComment = await res.json();
      // Replace optimistic with the canonical server row.
      setComments((prev) =>
        prev.map((c) =>
          c.id === optimisticId
            ? {
                id: String(data.id ?? optimisticId),
                user: String(data.profile?.discord_username ?? data.profile?.username ?? "Toi"),
                avatar: data.profile?.discord_avatar_url ?? undefined,
                text: String(data.content ?? data.body ?? trimmed),
                time: "maintenant",
              }
            : c,
        ),
      );
      setCommentStatus("idle");
    } catch {
      setComments((prev) => prev.filter((c) => c.id !== optimisticId));
      setCommentText(trimmed);
      setCommentStatus("error");
      setCommentError("Probleme reseau");
      commentErrorTimerRef.current = window.setTimeout(() => {
        setCommentStatus("idle");
        setCommentError(null);
      }, 4000);
    } finally {
      submittingRef.current = false;
    }
  }, [killId, isUuid, commentText]);

  return (
    <div className="space-y-4">
      {/* Auth prompt */}
      {authError && (
        <div className="rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-4 text-center">
          <p className="text-sm text-[var(--gold)] mb-2">Connecte-toi pour noter et commenter</p>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4752C4] transition-colors"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20.317 4.37a19.791 19.791 0 00-4.885-1.515.074.074 0 00-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 00-5.487 0 12.64 12.64 0 00-.617-1.25.077.077 0 00-.079-.037A19.736 19.736 0 003.677 4.37a.07.07 0 00-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 00.031.057 19.9 19.9 0 005.993 3.03.078.078 0 00.084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 00-.041-.106 13.107 13.107 0 01-1.872-.892.077.077 0 01-.008-.128 10.2 10.2 0 00.372-.292.074.074 0 01.077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 01.078.01c.12.098.246.198.373.292a.077.077 0 01-.006.127 12.299 12.299 0 01-1.873.892.077.077 0 00-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 00.084.028 19.839 19.839 0 006.002-3.03.077.077 0 00.032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 00-.031-.03z" />
            </svg>
            Connexion Discord
          </Link>
        </div>
      )}

      {/* Rating */}
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold">Note ce kill</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {rateStatus === "saving"
                ? "Enregistrement..."
                : rateStatus === "saved"
                ? `${userRating}/5 enregistr\u00e9 !`
                : rateStatus === "error"
                ? "Erreur"
                : userRating > 0
                ? `Ta note : ${userRating}/5`
                : "Clique pour noter"}
            </p>
            {avgRating != null && ratingCount > 0 && (
              <p className="text-[10px] text-[var(--text-disabled)] mt-1">
                Moyenne : {avgRating.toFixed(1)}/5 ({ratingCount} vote{ratingCount > 1 ? "s" : ""})
              </p>
            )}
          </div>
          <StarRating rating={userRating} size="lg" onRate={handleRate} />
        </div>
      </div>

      {/* Comments */}
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-4">
        <h3 className="font-display font-bold">Commentaires ({comments.length})</h3>

        <div className="flex gap-2">
          <input
            type="text"
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && commentStatus !== "submitting") {
                e.preventDefault();
                handleComment();
              }
            }}
            placeholder="Ajouter un commentaire..."
            maxLength={500}
            disabled={commentStatus === "submitting"}
            className="flex-1 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-[var(--gold)] disabled:opacity-60"
          />
          <button
            onClick={handleComment}
            disabled={!commentText.trim() || commentStatus === "submitting"}
            className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            {commentStatus === "submitting" ? "..." : "Poster"}
          </button>
        </div>

        {/* Comment error toast — auto-clears after 4s. */}
        {commentStatus === "error" && commentError && (
          <p className="text-xs text-[var(--red)]" role="status" aria-live="polite">
            {commentError}
          </p>
        )}

        {loadingComments && (
          <div className="py-6 text-center">
            <span className="inline-block h-4 w-4 rounded-full border-2 border-[var(--gold)] border-t-transparent animate-spin" />
          </div>
        )}

        {!loadingComments && comments.length === 0 && (
          <p className="py-6 text-center text-sm text-[var(--text-disabled)]">
            Aucun commentaire. Sois le premier !
          </p>
        )}

        {comments.map((c) => (
          <CommentThread key={c.id} comment={c} depth={0} />
        ))}
      </div>
    </div>
  );
}

function CommentThread({ comment: c, depth }: { comment: Comment; depth: number }) {
  const maxDepth = 3;
  const indent = Math.min(depth, maxDepth);

  return (
    <div style={{ marginLeft: indent > 0 ? `${indent * 16}px` : 0 }}>
      <div className={`rounded-lg bg-[var(--bg-primary)] border p-3 transition-opacity ${
        depth === 0 ? "border-[var(--border-subtle)]" : "border-[var(--border-gold)]/20"
      } ${c.pending ? "opacity-55" : ""}`}>
        <div className="flex items-center gap-2 mb-1">
          {c.avatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={c.avatar} alt="" className="h-6 w-6 rounded-full" />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[10px] font-bold text-[var(--gold)]">
              {c.user[0]?.toUpperCase() ?? "?"}
            </div>
          )}
          <span className="text-sm font-medium">{c.user}</span>
          <span className="text-[10px] text-[var(--text-disabled)]">{c.time}</span>
          {depth > 0 && (
            <span className="text-[9px] text-[var(--text-disabled)]">&middot; r&eacute;ponse</span>
          )}
        </div>
        <p className="text-sm text-[var(--text-secondary)] pl-8">{c.text}</p>
      </div>

      {/* Nested replies */}
      {c.replies && c.replies.length > 0 && (
        <div className="mt-2 space-y-2 border-l-2 border-[var(--gold)]/10 pl-2">
          {c.replies.map((reply) => (
            <CommentThread key={reply.id} comment={reply} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
