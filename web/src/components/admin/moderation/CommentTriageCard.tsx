"use client";

/**
 * CommentTriageCard — fast-keyboard-scan triage card for the moderation
 * queue (PR-loltok EE).
 *
 * Optimised for high-volume work :
 *   - Big enough to read on mobile (44px hit targets on actions)
 *   - Dense enough to see ~5 per screen on desktop
 *   - Author + clip thumb + comment text + Haiku toxicity badge in the
 *     same horizontal scanline
 *   - Action buttons large + colour-coded (Approve / Reject / Flag) so
 *     the operator's eye locks on without re-reading labels
 *
 * Keyboard semantics live in the parent ModerationQueue (j/k/a/r/f) — this
 * card just reflects `isFocused` for visual highlight, and exposes its
 * action callbacks so the parent can fire them on key events.
 */

import Link from "next/link";
import Image from "next/image";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";

export interface TriageComment {
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

interface Props {
  comment: TriageComment;
  /** True when this card is the keyboard cursor target. */
  isFocused?: boolean;
  /** Selected for bulk actions. */
  isSelected?: boolean;
  onSelectChange?: (selected: boolean) => void;
  onApprove: () => void;
  onReject: () => void;
  onFlag: () => void;
  /** Disable buttons while a request is in flight. */
  busy?: boolean;
}

/**
 * Toxicity badge colour mapping :
 *   < 0.3  → green  (clean)
 *   0.3-0.6 → yellow (borderline)
 *   ≥ 0.6  → red    (toxic)
 *
 * The threshold values match the Haiku prompt's mental model in
 * worker/modules/moderator.py.
 */
function toxicityVariant(
  score: number | null,
): "success" | "warn" | "danger" | "neutral" {
  if (score == null) return "neutral";
  if (score < 0.3) return "success";
  if (score < 0.6) return "warn";
  return "danger";
}

function toxicityIcon(score: number | null): string {
  if (score == null) return "?";
  if (score < 0.3) return "✓";
  if (score < 0.6) return "▽";
  return "☠";
}

export function CommentTriageCard({
  comment,
  isFocused = false,
  isSelected = false,
  onSelectChange,
  onApprove,
  onReject,
  onFlag,
  busy = false,
}: Props) {
  const tox = comment.toxicity_score;
  const focusRing = isFocused
    ? "ring-2 ring-[var(--gold)] ring-offset-2 ring-offset-[var(--bg-primary)]"
    : "";
  const selectedTone = isSelected
    ? "border-[var(--cyan)]/60 bg-[var(--cyan)]/5"
    : "border-[var(--border-gold)] bg-[var(--bg-surface)]";

  return (
    <article
      data-comment-id={comment.id}
      data-focused={isFocused || undefined}
      className={`rounded-xl border ${selectedTone} ${focusRing} p-4 transition-all`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        {/* Bulk select checkbox */}
        {onSelectChange ? (
          <label className="flex items-start pt-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={(e) => onSelectChange(e.target.checked)}
              aria-label="Sélectionner ce commentaire"
              className="h-4 w-4 cursor-pointer accent-[var(--gold)]"
            />
          </label>
        ) : null}

        {/* Clip thumbnail */}
        {comment.kills?.thumbnail_url ? (
          <Link
            href={`/admin/clips/${comment.kill_id}`}
            className="flex-shrink-0 self-start"
            aria-label="Voir le contexte du clip"
          >
            <Image
              src={comment.kills.thumbnail_url}
              alt=""
              width={48}
              height={80}
              className="h-20 w-12 rounded object-cover"
              loading="lazy"
            />
          </Link>
        ) : (
          <div className="h-20 w-12 flex-shrink-0 rounded bg-[var(--bg-elevated)]" />
        )}

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Header line: author / time / kill / badges */}
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <span className="font-bold text-[var(--gold)]">
              {comment.profiles?.discord_username ?? "Anonyme"}
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={comment.created_at}>
              {new Date(comment.created_at).toLocaleString("fr-FR")}
            </time>
            {comment.kills && (
              <>
                <span aria-hidden="true">·</span>
                <Link
                  href={`/admin/clips/${comment.kill_id}`}
                  className="hover:text-[var(--gold)]"
                >
                  {comment.kills.killer_champion} →{" "}
                  {comment.kills.victim_champion}
                </Link>
              </>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {tox != null && (
                <AdminBadge
                  variant={toxicityVariant(tox)}
                  icon={toxicityIcon(tox)}
                  title={`Score Haiku : ${(tox * 100).toFixed(0)}%`}
                >
                  {(tox * 100).toFixed(0)}%
                </AdminBadge>
              )}
              {comment.report_count > 0 && (
                <AdminBadge
                  variant="warn"
                  icon="⚠"
                  title={`${comment.report_count} signalement(s) utilisateur`}
                >
                  {comment.report_count}
                </AdminBadge>
              )}
            </div>
          </div>

          {/* Body */}
          <p className="text-sm text-[var(--text-primary)] break-words">
            {comment.content}
          </p>
          {comment.moderation_reason && (
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              Raison : {comment.moderation_reason}
            </p>
          )}
        </div>

        {/* Actions — column on desktop, row on mobile */}
        <div className="flex flex-row gap-1.5 md:flex-col md:gap-2 md:min-w-[120px]">
          {comment.moderation_status !== "approved" && (
            <AdminButton
              size="md"
              variant="primary"
              onClick={onApprove}
              disabled={busy}
              className="flex-1 md:flex-none min-h-[44px]"
              title="Approuver (a)"
              style={{
                background: "var(--green)",
                color: "var(--bg-primary)",
              }}
            >
              <span aria-hidden="true">✓</span>
              <span className="ml-1">Approuver</span>
            </AdminButton>
          )}
          {comment.moderation_status !== "rejected" && (
            <AdminButton
              size="md"
              variant="danger"
              onClick={onReject}
              disabled={busy}
              className="flex-1 md:flex-none min-h-[44px]"
              title="Rejeter (r)"
            >
              <span aria-hidden="true">✗</span>
              <span className="ml-1">Rejeter</span>
            </AdminButton>
          )}
          {comment.moderation_status !== "flagged" && (
            <AdminButton
              size="md"
              variant="secondary"
              onClick={onFlag}
              disabled={busy}
              className="flex-1 md:flex-none min-h-[44px]"
              title="Signaler (f)"
            >
              <span aria-hidden="true">⚠</span>
              <span className="ml-1">Flag</span>
            </AdminButton>
          )}
          {comment.kill_id && (
            <Link
              href={`/admin/clips/${comment.kill_id}`}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-[var(--border-gold)] bg-transparent px-3 text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--gold)] hover:text-[var(--gold)] md:flex-none"
              title="Voir le contexte"
            >
              Contexte
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}
