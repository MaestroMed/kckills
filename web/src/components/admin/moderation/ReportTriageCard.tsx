"use client";

/**
 * ReportTriageCard — triage card for the user-reports queue (PR-loltok EE).
 *
 * Mental model : "what target needs my attention", not "what individual
 * report" — the parent groups N reports against the same kill / comment
 * into a single card with a count badge. Per-card actions :
 *
 *   - Hide target  → flips kill_visible=false / comment.is_deleted etc.
 *                    (destructive — confirm dialog in parent)
 *   - Dismiss      → closes the reports without touching the target
 *                    (mild — confirm dialog in parent for ≥3 reports)
 *   - View target  → /kill/[id] or comment context
 *   - Ban reporter → if the reporter is abusive (rare; behind a sub-menu)
 */

import Link from "next/link";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";

export interface ReportRow {
  id: string;
  target_type: string;
  target_id: string;
  reporter_id: string | null;
  reporter_anon_id: string | null;
  reason_code: string;
  reason_text: string | null;
  status: string;
  action_taken: string | null;
  actioned_by: string | null;
  actioned_at: string | null;
  created_at: string;
}

export interface KillTargetMeta {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  thumbnail_url: string | null;
  ai_description: string | null;
  kill_visible: boolean | null;
  status: string | null;
  pipeline_status: string | null;
  publication_status: string | null;
}

export interface CommentTargetMeta {
  id: string;
  content: string | null;
  is_deleted: boolean | null;
  moderation_status: string | null;
  kill_id: string | null;
}

export interface ReportTriageGroup {
  target_type: string;
  target_id: string;
  count: number;
  reasons: string[];
  latest_at: string;
  reports: ReportRow[];
  target_meta: KillTargetMeta | CommentTargetMeta | null;
}

interface Props {
  group: ReportTriageGroup;
  busy: boolean;
  onHide: () => void;
  onDismiss: () => void;
}

const REASON_LABELS: Record<string, string> = {
  wrong_clip: "Clip ne correspond pas",
  no_kill_visible: "Kill invisible",
  wrong_player: "Mauvais joueur",
  spam: "Spam",
  toxic: "Toxique",
  harassment: "Harcèlement",
  other: "Autre",
};

function labelForTargetType(t: string): string {
  if (t === "kill") return "kill";
  if (t === "comment") return "commentaire";
  if (t === "community_clip") return "clip communautaire";
  return t;
}

function isKillMeta(
  meta: KillTargetMeta | CommentTargetMeta | null,
  type: string,
): meta is KillTargetMeta {
  return type === "kill" && meta != null && "killer_champion" in meta;
}

function isCommentMeta(
  meta: KillTargetMeta | CommentTargetMeta | null,
  type: string,
): meta is CommentTargetMeta {
  return type === "comment" && meta != null && "content" in meta;
}

export function ReportTriageCard({ group, busy, onHide, onDismiss }: Props) {
  const isKill = group.target_type === "kill";
  const isComment = group.target_type === "comment";
  const meta = group.target_meta;
  const killMeta = isKillMeta(meta, group.target_type) ? meta : null;
  const commentMeta = isCommentMeta(meta, group.target_type) ? meta : null;

  const isPending = group.reports.some((r) => r.status === "pending");
  const reasonChip =
    group.reasons.length > 0 ? group.reasons[0] : null;

  /**
   * Severity heuristic — colour the count badge red when ≥3 reports
   * land on the same target (community-flagged consensus). Single
   * reports stay neutral so we don't over-alarm on isolated noise.
   */
  const countVariant: "danger" | "warn" | "neutral" =
    group.count >= 3 ? "danger" : group.count >= 2 ? "warn" : "neutral";

  return (
    <article className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-start">
        {/* Target visual */}
        {isKill && killMeta?.thumbnail_url ? (
          <Link
            href={`/admin/clips/${group.target_id}`}
            className="flex-shrink-0 self-start"
            aria-label="Ouvrir le kill"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={killMeta.thumbnail_url}
              alt=""
              className="h-20 w-12 rounded object-cover"
              loading="lazy"
            />
          </Link>
        ) : (
          <div
            className="flex h-20 w-12 flex-shrink-0 items-center justify-center rounded bg-[var(--bg-elevated)] text-xl text-[var(--text-disabled)]"
            aria-hidden="true"
          >
            {isKill ? "▶" : isComment ? "✎" : "⊕"}
          </div>
        )}

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
            <AdminBadge
              variant={countVariant}
              icon="⚠"
              title={`${group.count} signalement${group.count > 1 ? "s" : ""}`}
            >
              {group.count} signalement{group.count > 1 ? "s" : ""}
            </AdminBadge>
            {reasonChip && (
              <AdminBadge variant="info" title="Raison principale">
                {REASON_LABELS[reasonChip] ?? reasonChip}
              </AdminBadge>
            )}
            <span className="truncate font-mono text-[10px] text-[var(--text-disabled)]">
              {labelForTargetType(group.target_type)} ·{" "}
              {group.target_id.slice(0, 8)}
            </span>
            <span className="ml-auto text-[10px]">
              dernier : {new Date(group.latest_at).toLocaleString("fr-FR")}
            </span>
          </div>

          {/* Target preview */}
          {isKill && killMeta && (
            <p className="truncate text-sm text-[var(--text-primary)]">
              <span className="font-bold text-[var(--gold)]">
                {killMeta.killer_champion ?? "?"}
              </span>{" "}
              <span className="text-[var(--text-muted)]">→</span>{" "}
              <span className="font-bold text-[var(--red)]">
                {killMeta.victim_champion ?? "?"}
              </span>
              {killMeta.ai_description && (
                <span className="ml-2 italic text-[var(--text-muted)]">
                  « {killMeta.ai_description.slice(0, 100)} »
                </span>
              )}
            </p>
          )}
          {isComment && commentMeta?.content && (
            <p className="line-clamp-2 text-sm text-[var(--text-primary)]">
              « {commentMeta.content.slice(0, 200)} »
            </p>
          )}
          {!isKill && !isComment && (
            <p className="text-sm italic text-[var(--text-muted)]">
              Cible : {group.target_id}
            </p>
          )}

          {/* All reasons (chips) */}
          {group.reasons.length > 1 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {group.reasons.slice(1).map((r) => (
                <span
                  key={r}
                  className="rounded-full border border-[var(--border-gold)]/40 bg-[var(--bg-primary)] px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
                >
                  {REASON_LABELS[r] ?? r}
                </span>
              ))}
            </div>
          )}

          {/* Free-form reason texts (anonymized — first 3 only) */}
          {group.reports.some((r) => r.reason_text) && (
            <ul className="mt-2 space-y-1">
              {group.reports
                .filter((r) => r.reason_text)
                .slice(0, 3)
                .map((r) => (
                  <li
                    key={r.id}
                    className="border-l-2 border-[var(--gold)]/20 pl-2 text-[11px] italic text-[var(--text-muted)]"
                  >
                    {r.reason_text}
                  </li>
                ))}
            </ul>
          )}

          {/* Already-actioned indicator */}
          {!isPending && (
            <p className="mt-2 text-[10px] text-[var(--text-disabled)]">
              {group.reports[0]?.action_taken &&
                `Action : ${group.reports[0].action_taken}`}
              {group.reports[0]?.actioned_at &&
                ` · ${new Date(group.reports[0].actioned_at).toLocaleString("fr-FR")}`}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-row gap-1.5 md:flex-col md:gap-2 md:min-w-[120px]">
          {isKill && (
            <Link
              href={`/admin/clips/${group.target_id}`}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-[var(--border-gold)] bg-transparent px-3 text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--gold)] hover:text-[var(--gold)] md:flex-none"
            >
              Voir kill
            </Link>
          )}
          {isComment && commentMeta?.kill_id && (
            <Link
              href={`/admin/clips/${commentMeta.kill_id}`}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md border border-[var(--border-gold)] bg-transparent px-3 text-[11px] font-bold uppercase tracking-wide text-[var(--text-secondary)] hover:border-[var(--gold)] hover:text-[var(--gold)] md:flex-none"
            >
              Voir kill
            </Link>
          )}
          {isPending && (
            <>
              <AdminButton
                size="md"
                variant="danger"
                onClick={onHide}
                disabled={busy}
                loading={busy}
                className="flex-1 md:flex-none min-h-[44px]"
                title="Masquer la cible (action destructive)"
              >
                Masquer
              </AdminButton>
              <AdminButton
                size="md"
                variant="ghost"
                onClick={onDismiss}
                disabled={busy}
                className="flex-1 md:flex-none min-h-[44px]"
                title="Rejeter les signalements sans toucher la cible"
              >
                Rejeter
              </AdminButton>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
