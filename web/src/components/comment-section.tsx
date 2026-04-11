"use client";

import { useState } from "react";
import type { Comment, Profile } from "@/types";

interface CommentSectionProps {
  killId: string;
  comments: (Comment & { profile?: Profile; replies?: (Comment & { profile?: Profile })[] })[];
  currentUserId?: string;
  onPost?: (body: string, parentId?: string) => void;
}

export function CommentSection({
  killId,
  comments,
  currentUserId,
  onPost,
}: CommentSectionProps) {
  const [body, setBody] = useState("");
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    onPost?.(body.trim());
    setBody("");
  };

  const handleReply = (parentId: string) => {
    if (!replyBody.trim()) return;
    onPost?.(replyBody.trim(), parentId);
    setReplyBody("");
    setReplyTo(null);
  };

  const topLevel = comments.filter((c) => !c.parent_id);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">
        Commentaires ({comments.length})
      </h3>

      {/* Post form */}
      {currentUserId ? (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ajouter un commentaire..."
            maxLength={2000}
            className="flex-1 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-muted)] outline-none focus:border-[var(--gold)]"
          />
          <button
            type="submit"
            disabled={!body.trim()}
            className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
          >
            Poster
          </button>
        </form>
      ) : (
        <p className="text-sm text-[var(--text-muted)]">
          Connectez-vous pour commenter.
        </p>
      )}

      {/* Comments list */}
      <div className="space-y-3">
        {topLevel.length === 0 && (
          <p className="py-8 text-center text-sm text-[var(--text-muted)]">
            Aucun commentaire. Soyez le premier !
          </p>
        )}
        {topLevel.map((comment) => (
          <CommentItem
            key={comment.id}
            comment={comment}
            currentUserId={currentUserId}
            replyTo={replyTo}
            replyBody={replyBody}
            onSetReplyTo={setReplyTo}
            onSetReplyBody={setReplyBody}
            onReply={handleReply}
          />
        ))}
      </div>
    </div>
  );
}

function CommentItem({
  comment,
  currentUserId,
  replyTo,
  replyBody,
  onSetReplyTo,
  onSetReplyBody,
  onReply,
}: {
  comment: Comment & { profile?: Profile; replies?: (Comment & { profile?: Profile })[] };
  currentUserId?: string;
  replyTo: string | null;
  replyBody: string;
  onSetReplyTo: (id: string | null) => void;
  onSetReplyBody: (body: string) => void;
  onReply: (parentId: string) => void;
}) {
  const timeAgo = getTimeAgo(comment.created_at);

  return (
    <div className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
      <div className="flex items-center gap-2">
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-xs font-bold">
          {(comment.profile?.username ?? "?")[0].toUpperCase()}
        </div>
        <span className="text-sm font-medium">
          {comment.profile?.username ?? "Anonyme"}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{timeAgo}</span>
        {comment.is_edited && (
          <span className="text-xs text-[var(--text-muted)]">(modifié)</span>
        )}
      </div>

      <p className="mt-1.5 text-sm leading-relaxed">{comment.body}</p>

      <div className="mt-2 flex items-center gap-3">
        <span className="text-xs text-[var(--text-muted)]">
          {comment.upvotes > 0 ? `+${comment.upvotes}` : ""}
        </span>
        {currentUserId && (
          <button
            className="text-xs text-[var(--text-muted)] hover:text-[var(--gold)]"
            onClick={() =>
              onSetReplyTo(replyTo === comment.id ? null : comment.id)
            }
          >
            Répondre
          </button>
        )}
      </div>

      {/* Reply form */}
      {replyTo === comment.id && (
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={replyBody}
            onChange={(e) => onSetReplyBody(e.target.value)}
            placeholder="Répondre..."
            maxLength={2000}
            className="flex-1 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
            autoFocus
          />
          <button
            onClick={() => onReply(comment.id)}
            disabled={!replyBody.trim()}
            className="rounded-lg bg-[var(--gold)] px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50"
          >
            Envoyer
          </button>
        </div>
      )}

      {/* Replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 space-y-2 border-l-2 border-[var(--border-gold)] pl-3">
          {comment.replies.map((reply) => (
            <div key={reply.id}>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                  {reply.profile?.username ?? "Anonyme"}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {getTimeAgo(reply.created_at)}
                </span>
              </div>
              <p className="mt-0.5 text-sm">{reply.body}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "maintenant";
  if (minutes < 60) return `il y a ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `il y a ${days}j`;
  return new Date(dateStr).toLocaleDateString("fr-FR");
}
