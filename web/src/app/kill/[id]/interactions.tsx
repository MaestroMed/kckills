"use client";

import { useState } from "react";
import { StarRating } from "@/components/star-rating";

export function KillInteractions({ killId }: { killId: string }) {
  const [userRating, setUserRating] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [comments, setComments] = useState<{ id: string; user: string; text: string; time: string }[]>([]);

  const handleRate = async (score: number) => {
    setUserRating(score);
    // Will call /api/kills/[id]/rate when Supabase is connected
  };

  const handleComment = () => {
    if (!commentText.trim()) return;
    setComments((prev) => [
      { id: `local-${Date.now()}`, user: "Toi", text: commentText.trim(), time: "maintenant" },
      ...prev,
    ]);
    setCommentText("");
    // Will call /api/kills/[id]/comment when Supabase is connected
  };

  return (
    <div className="space-y-4">
      {/* Rating */}
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold">Note ce kill</h3>
            <p className="text-xs text-[var(--text-muted)]">
              {userRating > 0 ? `Ta note : ${userRating}/5` : "Clique pour noter"}
            </p>
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
            onKeyDown={(e) => e.key === "Enter" && handleComment()}
            placeholder="Ajouter un commentaire..."
            maxLength={500}
            className="flex-1 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-[var(--gold)]"
          />
          <button
            onClick={handleComment}
            disabled={!commentText.trim()}
            className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
          >
            Poster
          </button>
        </div>

        {comments.length === 0 && (
          <p className="py-6 text-center text-sm text-[var(--text-disabled)]">
            Aucun commentaire. Sois le premier !
          </p>
        )}

        {comments.map((c) => (
          <div key={c.id} className="rounded-lg bg-[var(--bg-primary)] border border-[var(--border-subtle)] p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[10px] font-bold text-[var(--gold)]">
                {c.user[0].toUpperCase()}
              </div>
              <span className="text-sm font-medium">{c.user}</span>
              <span className="text-[10px] text-[var(--text-disabled)]">{c.time}</span>
            </div>
            <p className="text-sm text-[var(--text-secondary)] pl-8">{c.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
