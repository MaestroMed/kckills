"use client";

/**
 * Clip detail editor — single-clip admin view (PR-loltok ED).
 *
 * Migrated to Agent EA's primitives :
 *   - AdminBreadcrumbs / AdminSection / AdminCard / AdminButton / AdminBadge / AdminEmptyState
 *
 * Sections (per the ED brief) :
 *   - Hero : large player + key metadata
 *   - AI Annotations : version log with diff
 *   - Pipeline history : timeline of pipeline_runs touching the kill
 *   - Comments : embedded read-only thread
 *   - Reports : pending reports with link to moderation queue
 *   - Action header : Republish / Hide / Re-analyze / Re-clip / Set featured / Delete
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";
import { AdminBreadcrumbs } from "@/components/admin/ui/AdminBreadcrumbs";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminEmptyState } from "@/components/admin/ui/AdminEmptyState";
import { AdminSection } from "@/components/admin/ui/AdminSection";

const FIGHT_TYPES = [
  { value: "solo_kill", label: "Solo Kill (vrai 1v1)" },
  { value: "pick", label: "Pick (2v1)" },
  { value: "gank", label: "Gank (3v1+)" },
  { value: "skirmish_2v2", label: "Skirmish 2v2" },
  { value: "skirmish_3v3", label: "Skirmish 3v3" },
  { value: "teamfight_4v4", label: "Teamfight 4v4" },
  { value: "teamfight_5v5", label: "Teamfight 5v5" },
];

const ALL_TAGS = [
  "outplay", "teamfight", "solo_kill", "tower_dive", "baron_fight",
  "dragon_fight", "flash_predict", "1v2", "1v3", "clutch", "clean",
  "mechanical", "shutdown", "comeback", "engage", "peel", "snipe",
  "steal", "skirmish", "pick", "gank", "ace", "flank",
];

interface AnnotationVersion {
  id: string;
  model: string | null;
  cost_usd: number | null;
  description: string | null;
  tags: string[] | null;
  highlight_score: number | null;
  created_at: string;
}

interface PipelineRun {
  id: string;
  module_name: string;
  status: string | null;
  started_at: string;
  ended_at: string | null;
  error_summary: string | null;
}

interface CommentRow {
  id: string;
  content: string;
  moderation_status: string | null;
  created_at: string;
  toxicity_score: number | null;
  user_id: string | null;
}

interface ReportRow {
  id: string;
  reason: string | null;
  status: string | null;
  created_at: string;
}

interface Props {
  clip: {
    id: string;
    killer_champion: string | null;
    victim_champion: string | null;
    game_time_seconds: number | null;
    highlight_score: number | null;
    avg_rating: number | null;
    rating_count: number;
    comment_count: number;
    impression_count: number;
    clip_url_horizontal: string | null;
    clip_url_vertical: string | null;
    clip_url_vertical_low: string | null;
    thumbnail_url: string | null;
    og_image_url: string | null;
    ai_description: string | null;
    ai_tags: string[] | null;
    caster_hype_level: number | null;
    multi_kill: string | null;
    is_first_blood: boolean | null;
    tracked_team_involvement: string | null;
    assistants: { champion: string }[] | null;
    confidence: string | null;
    fight_type: string | null;
    lane_phase: string | null;
    matchup_lane: string | null;
    champion_class: string | null;
    kill_visible: boolean | null;
    needs_reclip: boolean | null;
    reclip_reason: string | null;
    status: string | null;
    retry_count: number | null;
    created_at: string;
    updated_at: string;
    games: {
      external_id?: string;
      game_number: number;
      vod_youtube_id?: string | null;
      vod_offset_seconds?: number | null;
      matches: {
        external_id?: string;
        stage?: string | null;
        scheduled_at?: string | null;
      } | null;
    } | null;
  };
}

interface ToastMsg {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
}

export function ClipDetailEditor({ clip }: Props) {
  const [desc, setDesc] = useState(clip.ai_description ?? "");
  const [fightType, setFightType] = useState(clip.fight_type ?? "solo_kill");
  const [tags, setTags] = useState<string[]>(clip.ai_tags ?? []);
  const [score, setScore] = useState<number>(clip.highlight_score ?? 5);
  const [hidden, setHidden] = useState<boolean>(clip.kill_visible === false);
  const [needsReclip, setNeedsReclip] = useState<boolean>(clip.needs_reclip ?? false);
  const [reclipReason, setReclipReason] = useState(clip.reclip_reason ?? "");
  const [saving, setSaving] = useState(false);
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  // Side data
  const [annotations, setAnnotations] = useState<AnnotationVersion[]>([]);
  const [runs, setRuns] = useState<PipelineRun[]>([]);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);

  const gt = clip.game_time_seconds ?? 0;
  const match = clip.games?.matches;
  const game = clip.games;

  const pushToast = (text: string, tone: ToastMsg["tone"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, text, tone }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 2800);
  };

  // Load auxiliary panels — best-effort, swallow 404s for endpoints that
  // may not be wired yet (we render an empty state rather than blowing up).
  useEffect(() => {
    let cancelled = false;
    const loadAll = async () => {
      const [aRes, rRes, cRes, repRes] = await Promise.allSettled([
        fetch(`/api/admin/clips/${clip.id}/annotations`),
        fetch(`/api/admin/clips/${clip.id}/pipeline`),
        fetch(`/api/admin/clips/${clip.id}/comments`),
        fetch(`/api/admin/clips/${clip.id}/reports`),
      ]);
      if (cancelled) return;
      if (aRes.status === "fulfilled" && aRes.value.ok) {
        try {
          const d = (await aRes.value.json()) as { items?: AnnotationVersion[] };
          setAnnotations(d.items ?? []);
        } catch {
          /* ignore */
        }
      }
      if (rRes.status === "fulfilled" && rRes.value.ok) {
        try {
          const d = (await rRes.value.json()) as { items?: PipelineRun[] };
          setRuns(d.items ?? []);
        } catch {
          /* ignore */
        }
      }
      if (cRes.status === "fulfilled" && cRes.value.ok) {
        try {
          const d = (await cRes.value.json()) as { items?: CommentRow[] };
          setComments(d.items ?? []);
        } catch {
          /* ignore */
        }
      }
      if (repRes.status === "fulfilled" && repRes.value.ok) {
        try {
          const d = (await repRes.value.json()) as { items?: ReportRow[] };
          setReports(d.items ?? []);
        } catch {
          /* ignore */
        }
      }
    };
    void loadAll();
    return () => {
      cancelled = true;
    };
  }, [clip.id]);

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/admin/clips/${clip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ai_description: desc,
          fight_type: fightType,
          ai_tags: tags,
          highlight_score: score,
          hidden,
          needs_reclip: needsReclip,
          reclip_reason: needsReclip ? reclipReason : null,
        }),
      });
      if (r.ok) {
        pushToast("Sauvegardé.");
      } else {
        const e = await r.json().catch(() => ({}));
        pushToast(`Erreur : ${e.error ?? `HTTP ${r.status}`}`, "error");
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Erreur réseau", "error");
    } finally {
      setSaving(false);
    }
  };

  const headerAction = async (action: "republish" | "hide" | "reanalyze" | "reclip" | "feature" | "delete") => {
    if (action === "delete" && !confirm("Supprimer définitivement ce clip ? Cette action est irréversible.")) {
      return;
    }
    if (action === "hide" && !confirm("Masquer ce clip du feed public ?")) return;
    if (action === "reclip" && !confirm("Marquer pour re-clip ?")) return;
    if (action === "reanalyze" && !confirm("Relancer l'analyse Gemini ?")) return;
    if (action === "feature" && !confirm("Pinner ce clip en featured aujourd'hui ?")) return;

    try {
      const r = await fetch(`/api/admin/clips/${clip.id}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (r.ok) {
        pushToast(`${action} appliqué.`);
        if (action === "delete") {
          window.location.href = "/admin/clips";
        }
      } else {
        const e = await r.json().catch(() => ({}));
        pushToast(`Erreur : ${e.error ?? `HTTP ${r.status}`}`, "error");
      }
    } catch (e) {
      pushToast(e instanceof Error ? e.message : "Erreur réseau", "error");
    }
  };

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const sortedAnnotations = useMemo(
    () => [...annotations].sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [annotations],
  );

  const statusBadge = useMemo(() => {
    switch (clip.status) {
      case "published":
        return <AdminBadge variant="success">publié</AdminBadge>;
      case "analyzed":
        return <AdminBadge variant="info">analysé</AdminBadge>;
      case "clip_error":
        return <AdminBadge variant="danger">erreur</AdminBadge>;
      case "manual_review":
        return <AdminBadge variant="warn">revue</AdminBadge>;
      default:
        return <AdminBadge variant="neutral">{clip.status ?? "—"}</AdminBadge>;
    }
  }, [clip.status]);

  return (
    <div className="space-y-5">
      <AdminBreadcrumbs
        items={[
          { label: "Admin", href: "/admin" },
          { label: "Clip Library", href: "/admin/clips" },
          { label: `${clip.killer_champion ?? "?"} → ${clip.victim_champion ?? "?"}` },
        ]}
      />

      {/* Header + actions */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-xl font-bold">
              <span className="text-[var(--gold)]">{clip.killer_champion}</span>
              <span className="mx-2 text-[var(--text-muted)]">→</span>
              <span>{clip.victim_champion}</span>
            </h1>
            {statusBadge}
            {clip.kill_visible === false && <AdminBadge variant="danger">masqué</AdminBadge>}
            {clip.needs_reclip && <AdminBadge variant="warn">à re-clip</AdminBadge>}
          </div>
          <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">{clip.id}</p>
        </div>
        <div className="text-right text-xs text-[var(--text-muted)]">
          <p>
            {match?.stage ?? "LEC"} G{game?.game_number}
          </p>
          <p className="font-mono">
            T+{Math.floor(gt / 60)}:{(gt % 60).toString().padStart(2, "0")}
          </p>
          <p className="text-[10px] text-[var(--text-disabled)]">
            {match?.scheduled_at?.slice(0, 10)}
          </p>
        </div>
      </div>

      {/* Action header */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-2.5">
        <AdminButton variant="primary" size="sm" onClick={() => headerAction("republish")}>
          Republier
        </AdminButton>
        <AdminButton variant="secondary" size="sm" onClick={() => headerAction("hide")}>
          Masquer
        </AdminButton>
        <AdminButton variant="secondary" size="sm" onClick={() => headerAction("reanalyze")}>
          Ré-analyser
        </AdminButton>
        <AdminButton variant="secondary" size="sm" onClick={() => headerAction("reclip")}>
          Re-clip
        </AdminButton>
        <AdminButton variant="secondary" size="sm" onClick={() => headerAction("feature")}>
          Set featured
        </AdminButton>
        <AdminButton
          variant="danger"
          size="sm"
          onClick={() => headerAction("delete")}
          className="ml-auto"
        >
          Supprimer
        </AdminButton>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Hero — video + raw metadata */}
        <div className="space-y-4">
          <AdminCard variant="dense">
            <div className="bg-black">
              <video
                key={clip.id}
                className="w-full aspect-video"
                src={clip.clip_url_horizontal ?? clip.clip_url_vertical ?? undefined}
                poster={clip.thumbnail_url ?? undefined}
                controls
                autoPlay
                muted
                playsInline
                preload="auto"
              />
            </div>
          </AdminCard>

          <AdminCard variant="default" title="Métadonnées">
            <div className="grid grid-cols-1 gap-1 text-xs">
              <Field label="Status" value={clip.status ?? "—"} />
              <Field label="Tracked involvement" value={clip.tracked_team_involvement ?? "—"} />
              <Field label="Confidence" value={clip.confidence ?? "—"} />
              <Field label="Multi-kill" value={clip.multi_kill ?? "—"} />
              <Field label="First blood" value={clip.is_first_blood ? "✓" : "—"} />
              <Field label="Caster hype" value={clip.caster_hype_level ?? "—"} />
              <Field label="Lane phase" value={clip.lane_phase ?? "—"} />
              <Field label="Matchup lane" value={clip.matchup_lane ?? "—"} />
              <Field label="Champion class" value={clip.champion_class ?? "—"} />
              <Field
                label="Assistants"
                value={
                  Array.isArray(clip.assistants)
                    ? `${clip.assistants.length} (${clip.assistants.map((a) => a.champion).join(", ")})`
                    : "—"
                }
              />
              <Field
                label="VOD"
                value={
                  game?.vod_youtube_id
                    ? `${game.vod_youtube_id} +${game.vod_offset_seconds}s`
                    : "—"
                }
              />
              <Field
                label="Created"
                value={clip.created_at?.slice(0, 16).replace("T", " ")}
              />
              <Field
                label="Updated"
                value={clip.updated_at?.slice(0, 16).replace("T", " ")}
              />
              <Field label="Impressions" value={clip.impression_count} />
              <Field
                label="Ratings"
                value={`${clip.avg_rating?.toFixed(1) ?? "—"} (${clip.rating_count})`}
              />
              <Field label="Comments" value={clip.comment_count} />
            </div>
          </AdminCard>
        </div>

        {/* Editor */}
        <AdminCard variant="default" title="Édition">
          <div className="space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] flex justify-between">
                <span>Description</span>
                <span
                  className={
                    desc.length < 40 ? "text-[var(--red)]" : "text-[var(--text-muted)]"
                  }
                >
                  {desc.length} chars
                </span>
              </label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)] resize-none"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Fight Type
              </label>
              <select
                value={fightType}
                onChange={(e) => setFightType(e.target.value)}
                className="mt-1 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2 text-sm"
              >
                {FIGHT_TYPES.map((ft) => (
                  <option key={ft.value} value={ft.value}>
                    {ft.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] flex justify-between">
                <span>Highlight Score</span>
                <span className="font-mono text-[var(--gold)] font-bold">
                  {score.toFixed(1)}/10
                </span>
              </label>
              <input
                type="range"
                min={1}
                max={10}
                step={0.5}
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="mt-1 w-full accent-[#C8AA6E]"
              />
            </div>

            <div>
              <label className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Tags ({tags.length})
              </label>
              <div className="flex flex-wrap gap-1 mt-1">
                {ALL_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold border transition-all ${
                      tags.includes(tag)
                        ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
                        : "bg-transparent border-[var(--border-gold)] text-[var(--text-disabled)] hover:text-[var(--text-muted)]"
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(e) => setHidden(e.target.checked)}
                className="accent-[var(--red)]"
              />
              <span className="text-xs text-[var(--text-muted)]">
                Masquer du feed (kill_visible=false)
              </span>
            </label>

            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={needsReclip}
                onChange={(e) => setNeedsReclip(e.target.checked)}
                className="accent-[var(--orange)]"
              />
              <span className="text-xs text-[var(--text-muted)]">
                Marquer pour re-clip (le worker le reprendra)
              </span>
            </label>
            {needsReclip && (
              <input
                type="text"
                value={reclipReason}
                onChange={(e) => setReclipReason(e.target.value)}
                placeholder="Raison du re-clip…"
                className="w-full rounded-lg border border-[var(--orange)]/40 bg-[var(--bg-primary)] px-3 py-2 text-sm"
              />
            )}

            <div className="flex gap-2 pt-1">
              <AdminButton variant="primary" loading={saving} fullWidth onClick={save}>
                Sauvegarder
              </AdminButton>
              <Link
                href={`/kill/${clip.id}`}
                target="_blank"
                className="rounded-md border border-[var(--border-gold)] px-4 py-2 text-xs text-[var(--text-muted)] hover:text-[var(--gold)] uppercase tracking-wide font-semibold"
              >
                Voir public
              </Link>
            </div>
          </div>
        </AdminCard>
      </div>

      {/* AI Annotations */}
      <AdminSection
        title="AI Annotations"
        subtitle="Versions successives produites par Gemini ou éditées à la main."
      >
        <AdminCard variant="dense">
          {sortedAnnotations.length === 0 ? (
            <AdminEmptyState
              icon="✦"
              title="Aucune version d'annotation"
              body="Le pipeline n'a pas encore produit d'analyse pour ce clip, ou l'endpoint /annotations n'est pas câblé."
              compact
            />
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-gold)] text-left">
                <tr>
                  <th className="px-2 py-2 w-32">Date</th>
                  <th className="px-2 py-2 w-28">Modèle</th>
                  <th className="px-2 py-2 w-16">Score</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 w-20">Coût</th>
                  <th className="px-2 py-2 w-32">Diff vs n-1</th>
                </tr>
              </thead>
              <tbody>
                {sortedAnnotations.map((a, i) => {
                  const prev = sortedAnnotations[i + 1];
                  const diffScore =
                    prev && a.highlight_score != null && prev.highlight_score != null
                      ? a.highlight_score - prev.highlight_score
                      : null;
                  return (
                    <tr key={a.id} className="border-b border-[var(--border-gold)]/20">
                      <td className="px-2 py-2 font-mono text-[10px] text-[var(--text-muted)]">
                        {a.created_at.slice(0, 16).replace("T", " ")}
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px]">{a.model ?? "—"}</td>
                      <td className="px-2 py-2 font-mono text-[var(--gold)]">
                        {a.highlight_score?.toFixed(1) ?? "—"}
                      </td>
                      <td className="px-2 py-2 line-clamp-2 max-w-md">
                        {a.description ?? "—"}
                      </td>
                      <td className="px-2 py-2 font-mono text-[10px] text-[var(--text-muted)]">
                        {a.cost_usd != null ? `$${a.cost_usd.toFixed(4)}` : "—"}
                      </td>
                      <td className="px-2 py-2 text-[10px]">
                        {diffScore != null ? (
                          <span
                            className={
                              diffScore > 0
                                ? "text-[var(--green)]"
                                : diffScore < 0
                                  ? "text-[var(--red)]"
                                  : "text-[var(--text-muted)]"
                            }
                          >
                            {diffScore > 0 ? "+" : ""}
                            {diffScore.toFixed(1)} score
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </AdminCard>
      </AdminSection>

      {/* Pipeline history */}
      <AdminSection
        title="Pipeline history"
        subtitle="Runs ayant touché ce kill_id."
      >
        <AdminCard variant="dense">
          {runs.length === 0 ? (
            <AdminEmptyState
              icon="◉"
              title="Aucun run lié"
              body="Ce clip n'apparaît dans aucun pipeline_runs (endpoint /pipeline non câblé ou run absent)."
              compact
            />
          ) : (
            <ol className="divide-y divide-[var(--border-gold)]/30">
              {runs.map((r) => (
                <li
                  key={r.id}
                  className="grid grid-cols-12 gap-2 px-3 py-2 text-xs items-center"
                >
                  <span className="col-span-3 font-mono text-[var(--gold)] truncate">
                    {r.module_name}
                  </span>
                  <span className="col-span-2">
                    {r.status === "succeeded" ? (
                      <AdminBadge variant="success">{r.status}</AdminBadge>
                    ) : r.status === "failed" ? (
                      <AdminBadge variant="danger">{r.status}</AdminBadge>
                    ) : (
                      <AdminBadge variant="neutral">{r.status ?? "—"}</AdminBadge>
                    )}
                  </span>
                  <span className="col-span-3 font-mono text-[10px] text-[var(--text-muted)]">
                    {r.started_at.slice(0, 16).replace("T", " ")}
                  </span>
                  <span className="col-span-4 text-[var(--text-muted)] truncate">
                    {r.error_summary ?? ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </AdminCard>
      </AdminSection>

      {/* Comments + Reports */}
      <div className="grid gap-4 lg:grid-cols-2">
        <AdminSection title="Commentaires" subtitle={`${comments.length} commentaire(s)`}>
          <AdminCard variant="dense">
            {comments.length === 0 ? (
              <AdminEmptyState icon="✎" title="Aucun commentaire" compact />
            ) : (
              <ul className="divide-y divide-[var(--border-gold)]/30 max-h-[280px] overflow-y-auto">
                {comments.map((c) => (
                  <li key={c.id} className="px-3 py-2 text-xs space-y-1">
                    <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                      <span className="font-mono">{c.user_id?.slice(0, 8) ?? "anon"}</span>
                      <span>•</span>
                      <span>{c.created_at.slice(0, 16).replace("T", " ")}</span>
                      {c.moderation_status === "approved" && (
                        <AdminBadge variant="success" size="sm">
                          ok
                        </AdminBadge>
                      )}
                      {c.moderation_status === "flagged" && (
                        <AdminBadge variant="warn" size="sm">
                          flagged
                        </AdminBadge>
                      )}
                      {c.moderation_status === "rejected" && (
                        <AdminBadge variant="danger" size="sm">
                          rejected
                        </AdminBadge>
                      )}
                    </div>
                    <p className="text-[var(--text-secondary)]">{c.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </AdminSection>

        <AdminSection
          title="Reports"
          subtitle={reports.length > 0 ? `${reports.length} signalement(s)` : undefined}
          action={
            reports.length > 0 && (
              <Link
                href="/admin/moderation/reports"
                className="text-[10px] text-[var(--gold)] hover:underline"
              >
                Aller à la file →
              </Link>
            )
          }
        >
          <AdminCard variant="dense">
            {reports.length === 0 ? (
              <AdminEmptyState icon="✓" title="Aucun report" compact />
            ) : (
              <ul className="divide-y divide-[var(--border-gold)]/30">
                {reports.map((r) => (
                  <li key={r.id} className="px-3 py-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[var(--orange)]">
                        {r.reason ?? "—"}
                      </span>
                      <AdminBadge
                        variant={r.status === "pending" ? "warn" : "neutral"}
                        size="sm"
                      >
                        {r.status ?? "?"}
                      </AdminBadge>
                    </div>
                    <p className="text-[10px] text-[var(--text-muted)] font-mono">
                      {r.created_at.slice(0, 16).replace("T", " ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </AdminSection>
      </div>

      {/* Toasts */}
      {toasts.length > 0 && (
        <div className="fixed bottom-6 right-6 z-[60] flex flex-col gap-2 items-end pointer-events-none">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`rounded-lg px-4 py-2 text-xs font-medium shadow-lg backdrop-blur-md ${
                t.tone === "success"
                  ? "bg-[var(--green)]/90 text-black"
                  : t.tone === "error"
                    ? "bg-[var(--red)]/90 text-white"
                    : "bg-[var(--bg-elevated)] text-[var(--text-primary)] border border-[var(--border-gold)]"
              }`}
            >
              {t.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className="font-mono text-[var(--text-primary)] truncate ml-2">
        {value ?? "—"}
      </span>
    </div>
  );
}
