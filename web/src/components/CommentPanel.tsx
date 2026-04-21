"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Comment {
  id: string;
  /** Renamed from `body` — DB schema uses `content`. */
  content: string;
  created_at: string;
  profile?: { username?: string; avatar_url?: string } | null;
  replies?: Comment[];
  /** Set by the API when the comment is still in Haiku moderation queue. */
  _pending?: boolean;
}

interface CommentPanelProps {
  killId: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CommentPanel({ killId, isOpen, onClose }: CommentPanelProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [postText, setPostText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);

  // Load comments on open
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    const controller = new AbortController();

    fetch(`/api/kills/${killId}/comment`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setComments(data);
        setLoading(false);
      })
      .catch((e) => {
        if (e.name !== "AbortError") {
          setError("Impossible de charger les commentaires");
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [isOpen, killId]);

  // Drag-to-dismiss
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      const dy = e.touches[0].clientY - touchStartY.current;
      if (dy > 100) onClose();
    },
    [onClose]
  );

  // Post comment
  const handlePost = async () => {
    if (!postText.trim() || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/kills/${killId}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: postText.trim() }),
      });
      if (res.status === 401) {
        setError("Connecte-toi avec Discord pour commenter");
        setPosting(false);
        return;
      }
      const data = await res.json();
      if (data.error) {
        setError(data.error);
      } else {
        // Optimistic: prepend to list
        setComments((prev) => [data, ...prev]);
        setPostText("");
        setError(null);
      }
    } catch {
      setError("Erreur lors de l'envoi");
    }
    setPosting(false);
  };

  if (!isOpen) return null;

  const totalComments = comments.reduce(
    (acc, c) => acc + 1 + (c.replies?.length ?? 0),
    0
  );

  return (
    <>
      {/* Backdrop */}
      <div className="absolute inset-0 z-30 bg-black/40" onClick={onClose} />

      {/* Panel */}
      <div
        ref={panelRef}
        className="comment-panel absolute bottom-0 left-0 right-0 z-40 flex flex-col rounded-t-2xl bg-black/90 backdrop-blur-xl border-t border-[var(--gold)]/20"
        style={{ maxHeight: "60vh" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-2">
          <div className="h-1 w-10 rounded-full bg-white/20" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pb-3 border-b border-white/5">
          <h3 className="text-sm font-bold text-white">
            {totalComments} commentaire{totalComments !== 1 ? "s" : ""}
          </h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white/10"
          >
            <svg className="h-4 w-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Comments list */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {loading ? (
            // Skeleton
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-3 animate-pulse">
                  <div className="h-8 w-8 rounded-full bg-white/10 shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 w-20 rounded bg-white/10" />
                    <div className="h-3 w-full rounded bg-white/5" />
                  </div>
                </div>
              ))}
            </>
          ) : comments.length === 0 ? (
            <p className="text-center text-sm text-[var(--text-muted)] py-8">
              Aucun commentaire. Sois le premier !
            </p>
          ) : (
            comments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))
          )}
        </div>

        {/* Post form */}
        <div className="border-t border-white/5 px-4 py-3">
          {error && (
            <p className="text-xs text-[var(--red)] mb-2">{error}</p>
          )}
          <div className="flex gap-2">
            <input
              type="text"
              value={postText}
              onChange={(e) => setPostText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handlePost()}
              placeholder="Ajoute un commentaire..."
              maxLength={500}
              className="flex-1 rounded-full bg-white/5 border border-white/10 px-4 py-2 text-sm text-white placeholder-white/30 outline-none focus:border-[var(--gold)]/50"
            />
            <button
              onClick={handlePost}
              disabled={!postText.trim() || posting}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--gold)]/20 text-[var(--gold)] disabled:opacity-30"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function CommentItem({ comment }: { comment: Comment }) {
  const username = comment.profile?.username ?? "Anonyme";
  const avatar = comment.profile?.avatar_url;
  const timeAgo = getTimeAgo(comment.created_at);
  const [reported, setReported] = useState(false);
  const [reporting, setReporting] = useState(false);

  const handleReport = async () => {
    if (reported || reporting) return;
    if (!confirm("Signaler ce commentaire comme inapproprié ?")) return;
    setReporting(true);
    try {
      const r = await fetch(`/api/comments/${comment.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "toxic" }),
      });
      if (r.ok || r.status === 401) setReported(true);
    } finally {
      setReporting(false);
    }
  };

  return (
    <div className="flex gap-3 group">
      {/* Avatar */}
      <div className="h-8 w-8 shrink-0 rounded-full bg-[var(--bg-elevated)] overflow-hidden">
        {avatar ? (
          <img src={avatar} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="h-full w-full flex items-center justify-center text-xs text-[var(--text-muted)]">
            {username[0]?.toUpperCase()}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-white/80 truncate">{username}</span>
          <span className="text-[10px] text-[var(--text-muted)]">{timeAgo}</span>
          {comment._pending && (
            <span className="rounded-full bg-[var(--gold)]/15 border border-[var(--gold)]/30 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-[var(--gold)]">
              modération…
            </span>
          )}
          <button
            onClick={handleReport}
            disabled={reported || reporting}
            className="ml-auto text-[10px] text-[var(--text-muted)] hover:text-[var(--red)] opacity-0 group-hover:opacity-100 transition-opacity disabled:opacity-50"
            title="Signaler"
          >
            {reported ? "✓ signalé" : "⚐"}
          </button>
        </div>
        <p className={`text-sm mt-0.5 break-words ${comment._pending ? "text-white/40 italic" : "text-white/70"}`}>{comment.content}</p>

        {/* Replies */}
        {comment.replies && comment.replies.length > 0 && (
          <div className="mt-3 ml-2 space-y-3 border-l border-white/5 pl-3">
            {comment.replies.map((reply) => (
              <CommentItem key={reply.id} comment={reply} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 60) return "maintenant";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}j`;
  return new Date(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
