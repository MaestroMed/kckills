"use client";

/**
 * ReportsQueue — admin moderation dashboard for the user-triggered
 * reports table (migration 032).
 *
 * Mental model : "what target needs attention", not "what individual
 * report" — multiple reports against the same kill / comment collapse
 * into a single triage card with a count badge.
 *
 * Per-card actions :
 *   - View target (link to /kill/[id] or admin clip detail)
 *   - Hide target (POST /api/admin/moderation/reports/hide-target —
 *     flips kill_visible=false AND publication_status='hidden', or
 *     comments.is_deleted=true, or community_clips.approved=false)
 *   - Dismiss (POST /api/admin/moderation/reports/dismiss — closes
 *     the reports without touching the target)
 *
 * Status tabs : pending (default), actioned, dismissed. Tab switching
 * triggers a re-fetch.
 */

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";

interface ReportRow {
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

interface KillMeta {
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

interface CommentMeta {
  id: string;
  content: string | null;
  is_deleted: boolean | null;
  moderation_status: string | null;
  kill_id: string | null;
}

interface ReportGroup {
  target_type: string;
  target_id: string;
  count: number;
  reasons: string[];
  latest_at: string;
  reports: ReportRow[];
  target_meta: KillMeta | CommentMeta | null;
}

const STATUSES = [
  { value: "pending", label: "À traiter", color: "var(--orange)" },
  { value: "actioned", label: "Actionnés", color: "var(--green)" },
  { value: "dismissed", label: "Rejetés", color: "var(--text-muted)" },
];

const REASON_LABELS: Record<string, string> = {
  wrong_clip: "Clip ne correspond pas",
  no_kill_visible: "Kill invisible",
  wrong_player: "Mauvais joueur",
  spam: "Spam",
  toxic: "Toxique",
  other: "Autre",
};

export function ReportsQueue() {
  const [status, setStatus] = useState("pending");
  const [groups, setGroups] = useState<ReportGroup[]>([]);
  const [totalGroups, setTotalGroups] = useState(0);
  const [totalReports, setTotalReports] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyTarget, setBusyTarget] = useState<string | null>(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(
        `/api/admin/moderation/reports?status=${status}&limit=200`,
      );
      if (r.ok) {
        const data: {
          groups?: ReportGroup[];
          total_groups?: number;
          total_reports?: number;
        } = await r.json();
        setGroups(data.groups ?? []);
        setTotalGroups(data.total_groups ?? 0);
        setTotalReports(data.total_reports ?? 0);
      } else {
        setGroups([]);
        setTotalGroups(0);
        setTotalReports(0);
      }
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  const hideTarget = async (g: ReportGroup) => {
    if (
      !confirm(
        `Masquer ce ${labelForTargetType(g.target_type)} et clôturer ${g.count} signalement(s) ?`,
      )
    )
      return;
    const key = `${g.target_type}:${g.target_id}`;
    setBusyTarget(key);
    try {
      const r = await fetch(
        "/api/admin/moderation/reports/hide-target",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            targetType: g.target_type,
            targetId: g.target_id,
            reportIds: g.reports.map((rep) => rep.id),
          }),
        },
      );
      if (r.ok) await fetchGroups();
      else {
        const j = await r.json().catch(() => ({}));
        alert(`Erreur : ${j.error ?? r.statusText}`);
      }
    } finally {
      setBusyTarget(null);
    }
  };

  const dismissReports = async (g: ReportGroup) => {
    if (
      !confirm(
        `Rejeter ${g.count} signalement(s) sans action sur le ${labelForTargetType(g.target_type)} ?`,
      )
    )
      return;
    const key = `${g.target_type}:${g.target_id}`;
    setBusyTarget(key);
    try {
      const r = await fetch("/api/admin/moderation/reports/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportIds: g.reports.map((rep) => rep.id),
        }),
      });
      if (r.ok) await fetchGroups();
      else {
        const j = await r.json().catch(() => ({}));
        alert(`Erreur : ${j.error ?? r.statusText}`);
      }
    } finally {
      setBusyTarget(null);
    }
  };

  return (
    <div className="space-y-4">
      <header>
        <h1 className="font-display text-2xl font-black text-[var(--gold)]">
          Reports
        </h1>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          {totalGroups} cible{totalGroups !== 1 ? "s" : ""} · {totalReports}{" "}
          signalement{totalReports !== 1 ? "s" : ""}
        </p>
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
      ) : groups.length === 0 ? (
        <p className="text-center text-[var(--text-muted)] py-8">
          Aucun signalement {status === "pending" ? "en attente" : status}.
        </p>
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <ReportCard
              key={`${g.target_type}:${g.target_id}`}
              group={g}
              busy={busyTarget === `${g.target_type}:${g.target_id}`}
              onHide={() => hideTarget(g)}
              onDismiss={() => dismissReports(g)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function labelForTargetType(t: string): string {
  if (t === "kill") return "kill";
  if (t === "comment") return "commentaire";
  if (t === "community_clip") return "clip communautaire";
  return t;
}

function ReportCard({
  group,
  busy,
  onHide,
  onDismiss,
}: {
  group: ReportGroup;
  busy: boolean;
  onHide: () => void;
  onDismiss: () => void;
}) {
  const isKill = group.target_type === "kill";
  const isComment = group.target_type === "comment";
  const meta = group.target_meta;
  const killMeta = isKill ? (meta as KillMeta | null) : null;
  const commentMeta = isComment ? (meta as CommentMeta | null) : null;

  const isPending = group.reports.some((r) => r.status === "pending");

  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4">
      <div className="flex gap-3">
        {/* Target visual */}
        {isKill && killMeta?.thumbnail_url ? (
          <Link
            href={`/admin/clips/${group.target_id}`}
            className="flex-shrink-0"
          >
            <img
              src={killMeta.thumbnail_url}
              alt=""
              className="w-12 h-20 rounded object-cover"
              loading="lazy"
            />
          </Link>
        ) : (
          <div className="w-12 h-20 rounded bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-disabled)] text-xl flex-shrink-0">
            {isKill ? "▶" : isComment ? "✎" : "⊕"}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-1 flex-wrap">
            <span className="rounded bg-[var(--orange)]/20 text-[var(--orange)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
              {group.count} signalement{group.count > 1 ? "s" : ""}
            </span>
            <span className="font-mono text-[10px] text-[var(--text-disabled)] truncate">
              {labelForTargetType(group.target_type)} · {group.target_id.slice(0, 8)}
            </span>
            <span className="ml-auto text-[10px]">
              dernier : {new Date(group.latest_at).toLocaleString("fr-FR")}
            </span>
          </div>

          {/* Target preview line */}
          {isKill && killMeta && (
            <p className="text-sm text-[var(--text-primary)] truncate">
              <span className="text-[var(--gold)] font-bold">
                {killMeta.killer_champion ?? "?"}
              </span>{" "}
              <span className="text-[var(--text-muted)]">→</span>{" "}
              <span className="text-[var(--red)] font-bold">
                {killMeta.victim_champion ?? "?"}
              </span>
              {killMeta.ai_description && (
                <span className="text-[var(--text-muted)] ml-2 italic">
                  « {killMeta.ai_description.slice(0, 100)} »
                </span>
              )}
            </p>
          )}
          {isComment && commentMeta?.content && (
            <p className="text-sm text-[var(--text-primary)] line-clamp-2">
              « {commentMeta.content.slice(0, 200)} »
            </p>
          )}
          {!isKill && !isComment && (
            <p className="text-sm text-[var(--text-muted)] italic">
              Cible : {group.target_id}
            </p>
          )}

          {/* Reasons */}
          <div className="mt-2 flex flex-wrap gap-1">
            {group.reasons.map((r) => (
              <span
                key={r}
                className="rounded-full bg-[var(--bg-primary)] border border-[var(--border-gold)]/40 px-2 py-0.5 text-[10px] text-[var(--text-secondary)]"
              >
                {REASON_LABELS[r] ?? r}
              </span>
            ))}
          </div>

          {/* Free-form reason texts (if any) */}
          {group.reports.some((r) => r.reason_text) && (
            <ul className="mt-2 space-y-1">
              {group.reports
                .filter((r) => r.reason_text)
                .slice(0, 3)
                .map((r) => (
                  <li
                    key={r.id}
                    className="text-[11px] text-[var(--text-muted)] italic border-l-2 border-[var(--gold)]/20 pl-2"
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
        <div className="flex flex-col gap-1.5">
          {isKill && (
            <Link
              href={`/admin/clips/${group.target_id}`}
              className="rounded-md bg-[var(--bg-primary)] border border-[var(--border-gold)]/40 text-[var(--text-secondary)] px-3 py-1.5 text-[10px] font-bold text-center hover:border-[var(--gold)]/60"
            >
              Ouvrir
            </Link>
          )}
          {isComment && commentMeta?.kill_id && (
            <Link
              href={`/admin/clips/${commentMeta.kill_id}`}
              className="rounded-md bg-[var(--bg-primary)] border border-[var(--border-gold)]/40 text-[var(--text-secondary)] px-3 py-1.5 text-[10px] font-bold text-center hover:border-[var(--gold)]/60"
            >
              Voir kill
            </Link>
          )}
          {isPending && (
            <>
              <button
                disabled={busy}
                onClick={onHide}
                className="rounded-md bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)] px-3 py-1.5 text-[10px] font-bold hover:bg-[var(--red)]/30 disabled:opacity-50"
              >
                {busy ? "..." : "Masquer"}
              </button>
              <button
                disabled={busy}
                onClick={onDismiss}
                className="rounded-md border border-[var(--text-muted)]/40 text-[var(--text-muted)] px-3 py-1.5 text-[10px] font-bold hover:bg-[var(--text-muted)]/10 disabled:opacity-50"
              >
                {busy ? "..." : "Rejeter"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
