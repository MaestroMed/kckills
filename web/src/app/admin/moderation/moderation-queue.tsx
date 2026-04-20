"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface CommentRow {
  id: string;
  content: string;
  kill_id: string;
  user_id: string;
  parent_id: string | null;
  moderation_status: string;
  moderation_reason: string | null;
  toxicity_score: number | null;
  upvotes: number;
  report_count: number;
  is_deleted: boolean;
  created_at: string;
  kills: {
    id: string;
    killer_champion: string | null;
    victim_champion: string | null;
    thumbnail_url: string | null;
    ai_description: string | null;
  } | null;
  profiles: {
    discord_username: string | null;
    discord_avatar_url: string | null;
  } | null;
}

const STATUSES = [
  { value: "pending", label: "En attente", color: "var(--orange)" },
  { value: "flagged", label: "Signalés", color: "var(--red)" },
  { value: "approved", label: "Approuvés", color: "var(--green)" },
  { value: "rejected", label: "Rejetés", color: "var(--text-muted)" },
];

export function ModerationQueue() {
  const [status, setStatus] = useState("pending");
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const fetchComments = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/moderation/comments?status=${status}&limit=100`);
      if (r.ok) {
        const data = await r.json();
        setComments(data.items ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  const moderate = async (id: string, action: string, reason?: string) => {
    const r = await fetch(`/api/admin/moderation/comments/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason }),
    });
    if (r.ok) void fetchComments();
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">Moderation</h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{total} commentaires</p>
      </header>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-[var(--border-gold)]">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatus(s.value)}
            className={`px-4 py-2 text-xs font-bold uppercase tracking-widest border-b-2 transition-all ${
              status === s.value
                ? "border-[var(--gold)] text-[var(--gold)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-center text-[var(--text-muted)] py-8">Chargement...</p>
      ) : comments.length === 0 ? (
        <p className="text-center text-[var(--text-muted)] py-8">Aucun commentaire à modérer</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <CommentCard key={c.id} comment={c} onModerate={moderate} />
          ))}
        </div>
      )}
    </div>
  );
}

function CommentCard({
  comment,
  onModerate,
}: {
  comment: CommentRow;
  onModerate: (id: string, action: string, reason?: string) => void;
}) {
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <div className="flex gap-3">
        {/* Clip thumbnail */}
        {comment.kills?.thumbnail_url ? (
          <Link href={`/admin/clips/${comment.kill_id}`} className="flex-shrink-0">
            <img
              src={comment.kills.thumbnail_url}
              alt=""
              className="w-12 h-20 rounded object-cover"
              loading="lazy"
            />
          </Link>
        ) : (
          <div className="w-12 h-20 rounded bg-[var(--bg-elevated)]" />
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-1">
            <span className="text-[var(--gold)] font-bold">{comment.profiles?.discord_username ?? "Anonyme"}</span>
            <span>·</span>
            <span>{new Date(comment.created_at).toLocaleString("fr-FR")}</span>
            {comment.kills && (
              <>
                <span>·</span>
                <Link href={`/admin/clips/${comment.kill_id}`} className="hover:text-[var(--gold)]">
                  {comment.kills.killer_champion} → {comment.kills.victim_champion}
                </Link>
              </>
            )}
            {comment.toxicity_score != null && comment.toxicity_score > 0.5 && (
              <span className="ml-auto rounded bg-[var(--red)]/20 text-[var(--red)] px-2 py-0.5 text-[9px] font-bold">
                ☠ {(comment.toxicity_score * 100).toFixed(0)}%
              </span>
            )}
            {comment.report_count > 0 && (
              <span className="rounded bg-[var(--orange)]/20 text-[var(--orange)] px-2 py-0.5 text-[9px] font-bold">
                ⚠ {comment.report_count} reports
              </span>
            )}
          </div>
          <p className="text-sm text-[var(--text-primary)]">{comment.content}</p>
          {comment.moderation_reason && (
            <p className="text-[10px] text-[var(--text-muted)] mt-1">Raison: {comment.moderation_reason}</p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-1.5">
          {comment.moderation_status !== "approved" && (
            <button
              onClick={() => onModerate(comment.id, "approve")}
              className="rounded-md bg-[var(--green)]/20 border border-[var(--green)]/40 text-[var(--green)] px-3 py-1.5 text-[10px] font-bold hover:bg-[var(--green)]/30"
            >
              Approuver
            </button>
          )}
          {comment.moderation_status !== "rejected" && (
            <button
              onClick={() => {
                const reason = prompt("Raison du rejet (optionnel)");
                if (reason !== null) onModerate(comment.id, "reject", reason);
              }}
              className="rounded-md bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)] px-3 py-1.5 text-[10px] font-bold hover:bg-[var(--red)]/30"
            >
              Rejeter
            </button>
          )}
          <button
            onClick={() => {
              if (confirm("Supprimer ce commentaire ?")) onModerate(comment.id, "delete");
            }}
            className="rounded-md border border-[var(--text-muted)]/40 text-[var(--text-muted)] px-3 py-1.5 text-[10px] font-bold hover:bg-[var(--text-muted)]/10"
          >
            Supprimer
          </button>
        </div>
      </div>
    </div>
  );
}
