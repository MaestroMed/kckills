"use client";

/**
 * Clip Library — admin clips browser (PR-loltok ED).
 *
 * Migrated to Agent EA's primitives :
 *   - AdminBreadcrumbs / AdminSection / AdminCard / AdminButton / AdminBadge / AdminEmptyState
 *
 * New widgets (Agent ED) :
 *   - <ClipFilterBar />     — full filter row
 *   - <ClipBulkActions />   — sticky bar when rows are selected
 *
 * Adds a List ↔ Grid view toggle for visual scanning.
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { ScoreChip } from "@/components/admin/ScoreChip";
import { ClipDetailDrawer } from "@/components/admin/ClipDetailDrawer";
import { AdminBadge } from "@/components/admin/ui/AdminBadge";
import { AdminBreadcrumbs } from "@/components/admin/ui/AdminBreadcrumbs";
import { AdminButton } from "@/components/admin/ui/AdminButton";
import { AdminCard } from "@/components/admin/ui/AdminCard";
import { AdminEmptyState } from "@/components/admin/ui/AdminEmptyState";
import { AdminSection } from "@/components/admin/ui/AdminSection";
import {
  ClipFilterBar,
  DEFAULT_CLIP_FILTERS,
  type ClipFilterValue,
} from "@/components/admin/clips/ClipFilterBar";
import {
  ClipBulkActions,
  type ClipBulkAction,
  type ClipBulkResult,
} from "@/components/admin/clips/ClipBulkActions";

interface ClipRow {
  id: string;
  killer_champion: string | null;
  victim_champion: string | null;
  game_time_seconds: number | null;
  highlight_score: number | null;
  avg_rating: number | null;
  rating_count: number;
  comment_count: number;
  impression_count: number;
  clip_url_vertical: string | null;
  thumbnail_url: string | null;
  ai_description: string | null;
  ai_tags: string[];
  multi_kill: string | null;
  is_first_blood: boolean;
  tracked_team_involvement: string | null;
  kill_visible: boolean | null;
  fight_type: string | null;
  needs_reclip: boolean;
  status: string | null;
  created_at: string;
  updated_at: string;
  games: {
    game_number: number;
    matches: { external_id: string; stage: string | null; scheduled_at: string | null } | null;
  } | null;
}

const SORTS = [
  { value: "score_desc", label: "Score ↓" },
  { value: "score_asc", label: "Score ↑" },
  { value: "recent", label: "Plus récent" },
  { value: "oldest", label: "Plus ancien" },
  { value: "rating", label: "Rating" },
  { value: "comments", label: "Commentaires" },
];

const SAVED_VIEWS: {
  id: string;
  label: string;
  patch: Partial<ClipFilterValue>;
}[] = [
  { id: "all", label: "Tout", patch: { hidden: "false" } },
  {
    id: "no_description",
    label: "Sans description",
    patch: { hasDescription: "false", hidden: "false" },
  },
  { id: "low_score", label: "Score < 5", patch: { scoreMin: 1, scoreMax: 5 } },
  { id: "high_score", label: "Score ≥ 8", patch: { scoreMin: 8, scoreMax: 10 } },
  { id: "hidden", label: "Masqués", patch: { hidden: "only" } },
];

type ViewMode = "list" | "grid";

interface ToastMsg {
  id: number;
  text: string;
  tone: "success" | "error" | "info";
}

export function ClipsLibrary() {
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<ClipFilterValue>(DEFAULT_CLIP_FILTERS);
  const [qDebounced, setQDebounced] = useState("");
  const [sort, setSort] = useState("score_desc");
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openClipId, setOpenClipId] = useState<string | null>(null);
  const [activeView, setActiveView] = useState("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [toasts, setToasts] = useState<ToastMsg[]>([]);

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(filters.q), 300);
    return () => clearTimeout(t);
  }, [filters.q]);

  const pushToast = useCallback(
    (text: string, tone: ToastMsg["tone"] = "success") => {
      const id = Date.now() + Math.random();
      setToasts((prev) => [...prev, { id, text, tone }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 2800);
    },
    [],
  );

  const fetchClips = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (qDebounced) params.set("q", qDebounced);
    filters.fightTypes.forEach((ft) => params.append("fight_type", ft));
    if (filters.hidden) params.set("hidden", filters.hidden);
    if (filters.hasDescription) params.set("has_description", filters.hasDescription);
    if (filters.scoreMin > 1) params.set("min_score", String(filters.scoreMin));
    if (filters.scoreMax < 10) params.set("max_score", String(filters.scoreMax));
    if (filters.role !== "any") params.set("involvement", filters.role);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.multiKill !== "any") params.set("multi_kill", filters.multiKill);
    if (filters.dateFrom) params.set("from", filters.dateFrom);
    if (filters.dateTo) params.set("to", filters.dateTo);
    // Wave 12 anti-pollution filter — pass clip_context value if not "any".
    if (filters.clipContext && filters.clipContext !== "any") {
      params.set("clip_context", filters.clipContext);
    }
    params.set("sort", sort);
    params.set("limit", String(limit));

    try {
      const r = await fetch(`/api/admin/clips?${params}`);
      if (r.ok) {
        const data = await r.json();
        setClips(data.items ?? []);
        setTotal(data.total ?? 0);
      } else {
        pushToast("Erreur de chargement des clips", "error");
      }
    } catch {
      pushToast("Erreur réseau", "error");
    } finally {
      setLoading(false);
    }
  }, [qDebounced, filters, sort, limit, pushToast]);

  useEffect(() => {
    void fetchClips();
  }, [fetchClips]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => setSelected(new Set(clips.map((c) => c.id)));
  const clearSelection = () => setSelected(new Set());

  const applyView = (view: (typeof SAVED_VIEWS)[number]) => {
    setActiveView(view.id);
    setFilters((prev) => ({ ...DEFAULT_CLIP_FILTERS, ...view.patch, q: prev.q }));
  };

  const handleBulk = useCallback(
    async (
      action: ClipBulkAction,
      payload?: Record<string, unknown>,
    ): Promise<ClipBulkResult> => {
      // approve_qc / set_featured aren't part of /api/admin/clips/bulk yet —
      // surface a friendly toast and bail without a request that 400s.
      if (action === "approve_qc" || action === "set_featured") {
        pushToast(
          `Action « ${action} » : endpoint non disponible côté serveur (à câbler).`,
          "info",
        );
        return { ok: false };
      }
      try {
        const r = await fetch("/api/admin/clips/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: [...selected], action, payload }),
        });
        if (r.ok) {
          pushToast(`${action} appliqué à ${selected.size} clip(s).`, "success");
          clearSelection();
          void fetchClips();
          return { ok: true };
        }
        const err = await r.json().catch(() => ({}));
        pushToast(`Erreur : ${err.error ?? `HTTP ${r.status}`}`, "error");
        return { ok: false, message: err.error };
      } catch (e) {
        pushToast(e instanceof Error ? e.message : "Erreur réseau", "error");
        return { ok: false };
      }
    },
    [selected, pushToast, fetchClips],
  );

  const visibleSelection = useMemo(
    () => clips.filter((c) => selected.has(c.id)),
    [clips, selected],
  );

  return (
    <div className="space-y-5">
      <AdminBreadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Clip Library" }]} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">
            Clip Library
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {total} clip{total > 1 ? "s" : ""} ·{" "}
            {selected.size > 0
              ? `${selected.size} sélectionné${selected.size > 1 ? "s" : ""}`
              : "aucune sélection"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="rounded-md border border-[var(--border-gold)] flex overflow-hidden">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1 text-[11px] font-semibold ${
                viewMode === "list"
                  ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                  : "text-[var(--text-muted)] hover:text-[var(--gold)]"
              }`}
              aria-pressed={viewMode === "list"}
            >
              Liste
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`px-2.5 py-1 text-[11px] font-semibold ${
                viewMode === "grid"
                  ? "bg-[var(--gold)]/20 text-[var(--gold)]"
                  : "text-[var(--text-muted)] hover:text-[var(--gold)]"
              }`}
              aria-pressed={viewMode === "grid"}
            >
              Grille
            </button>
          </div>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
            aria-label="Tri"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <input
            type="number"
            min={10}
            max={500}
            step={50}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-16 rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
            title="Limite par page"
            aria-label="Limite par page"
          />
        </div>
      </div>

      {/* Saved views */}
      <div className="flex flex-wrap gap-1.5">
        {SAVED_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => applyView(v)}
            className={`rounded-full px-3 py-1 text-xs font-bold border transition-all ${
              activeView === v.id
                ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
                : "border-[var(--border-gold)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      <ClipFilterBar
        value={filters}
        onChange={setFilters}
        onReset={() => {
          setFilters(DEFAULT_CLIP_FILTERS);
          setActiveView("all");
        }}
      />

      <ClipBulkActions
        selectedCount={selected.size}
        onClear={clearSelection}
        onAction={handleBulk}
      />

      <AdminSection
        title={viewMode === "list" ? "Résultats" : "Aperçu visuel"}
        subtitle={
          loading
            ? "Chargement…"
            : `${clips.length} affiché${clips.length > 1 ? "s" : ""} sur ${total}`
        }
        action={
          visibleSelection.length > 0 && (
            <AdminButton variant="ghost" size="sm" onClick={clearSelection}>
              Tout désélectionner
            </AdminButton>
          )
        }
      >
        {loading ? (
          <AdminCard variant="default">
            <p className="text-center text-sm text-[var(--text-muted)] py-12">
              Chargement…
            </p>
          </AdminCard>
        ) : clips.length === 0 ? (
          <AdminCard variant="default">
            <AdminEmptyState
              icon="◎"
              title="Aucun clip ne correspond"
              body="Ajuste les filtres ou réinitialise pour voir tout le catalogue."
              action={
                <AdminButton
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setFilters(DEFAULT_CLIP_FILTERS);
                    setActiveView("all");
                  }}
                >
                  Réinitialiser
                </AdminButton>
              }
            />
          </AdminCard>
        ) : viewMode === "list" ? (
          <AdminCard variant="dense">
            <table className="w-full text-xs">
              <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-gold)] text-left">
                <tr>
                  <th className="px-2 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={selected.size > 0 && selected.size === clips.length}
                      onChange={() =>
                        selected.size === clips.length ? clearSelection() : selectAll()
                      }
                      className="accent-[var(--gold)]"
                      aria-label="Tout sélectionner"
                    />
                  </th>
                  <th className="px-2 py-2 w-20">Clip</th>
                  <th className="px-2 py-2">Kill</th>
                  <th className="px-2 py-2 w-32">Match</th>
                  <th className="px-2 py-2 w-14">Time</th>
                  <th className="px-2 py-2 w-24">Statut</th>
                  <th className="px-2 py-2 w-14">Score</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="px-2 py-2 w-20">Stats</th>
                  <th className="px-2 py-2 w-12">Vis.</th>
                  <th className="px-2 py-2 w-16">Action</th>
                </tr>
              </thead>
              <tbody>
                {clips.map((c) => (
                  <ClipRowView
                    key={c.id}
                    clip={c}
                    selected={selected.has(c.id)}
                    onToggle={() => toggleSelect(c.id)}
                    onOpen={() => setOpenClipId(c.id)}
                  />
                ))}
              </tbody>
            </table>
          </AdminCard>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {clips.map((c) => (
              <ClipGridCard
                key={c.id}
                clip={c}
                selected={selected.has(c.id)}
                onToggle={() => toggleSelect(c.id)}
                onOpen={() => setOpenClipId(c.id)}
              />
            ))}
          </div>
        )}
      </AdminSection>

      <ClipDetailDrawer
        clipId={openClipId}
        onClose={() => setOpenClipId(null)}
        onSaved={() => fetchClips()}
        onPrev={() => {
          if (!openClipId) return;
          const idx = clips.findIndex((c) => c.id === openClipId);
          if (idx > 0) setOpenClipId(clips[idx - 1].id);
        }}
        onNext={() => {
          if (!openClipId) return;
          const idx = clips.findIndex((c) => c.id === openClipId);
          if (idx < clips.length - 1) setOpenClipId(clips[idx + 1].id);
        }}
      />

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

function statusVariant(status: string | null) {
  switch (status) {
    case "published":
      return { variant: "success" as const, label: "publié" };
    case "analyzed":
      return { variant: "info" as const, label: "analysé" };
    case "clipped":
      return { variant: "pending" as const, label: "clippé" };
    case "clip_error":
      return { variant: "danger" as const, label: "erreur clip" };
    case "manual_review":
      return { variant: "warn" as const, label: "revue" };
    default:
      return { variant: "neutral" as const, label: status ?? "—" };
  }
}

function ClipRowView({
  clip,
  selected,
  onToggle,
  onOpen,
}: {
  clip: ClipRow;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const gt = clip.game_time_seconds ?? 0;
  const match = clip.games?.matches;
  const date = match?.scheduled_at?.slice(0, 10) ?? "—";
  const sv = statusVariant(clip.status);

  return (
    <tr
      className={`border-b border-[var(--border-gold)]/20 hover:bg-[var(--bg-elevated)]/40 cursor-pointer ${
        selected ? "bg-[var(--gold)]/5" : ""
      }`}
      onClick={onOpen}
    >
      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="accent-[var(--gold)]"
          aria-label={`Sélectionner ${clip.killer_champion} → ${clip.victim_champion}`}
        />
      </td>
      <td className="px-2 py-2">
        {clip.thumbnail_url ? (
          <div className="relative w-14 h-24 rounded overflow-hidden bg-black">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={clip.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" />
            {clip.multi_kill && (
              <span className="absolute top-0.5 right-0.5 rounded bg-[var(--orange)] text-[8px] font-black text-black px-1">
                {clip.multi_kill[0].toUpperCase()}
              </span>
            )}
          </div>
        ) : (
          <div className="w-14 h-24 rounded bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-disabled)]">
            ?
          </div>
        )}
      </td>
      <td className="px-2 py-2">
        <span className="font-bold text-[var(--gold)]">{clip.killer_champion}</span>
        <span className="mx-1 text-[var(--text-muted)]">→</span>
        <span className="text-[var(--text-primary)]">{clip.victim_champion}</span>
        {clip.is_first_blood && <span className="ml-1 text-[var(--red)]">●FB</span>}
      </td>
      <td className="px-2 py-2 text-[var(--text-muted)]">
        <div className="font-mono text-[10px]">{date}</div>
        <div>
          {match?.stage ?? "LEC"} G{clip.games?.game_number}
        </div>
      </td>
      <td className="px-2 py-2 font-mono text-[10px]">
        {Math.floor(gt / 60)}:{(gt % 60).toString().padStart(2, "0")}
      </td>
      <td className="px-2 py-2">
        <AdminBadge variant={sv.variant}>{sv.label}</AdminBadge>
      </td>
      <td className="px-2 py-2">
        <ScoreChip value={clip.highlight_score} />
      </td>
      <td className="px-2 py-2">
        <div className="line-clamp-2 text-[11px] text-[var(--text-secondary)] max-w-md">
          {clip.ai_description ?? "—"}
        </div>
        <div className="flex gap-0.5 mt-0.5 flex-wrap">
          {(clip.ai_tags ?? []).slice(0, 3).map((t) => (
            <span key={t} className="text-[9px] text-[var(--text-muted)]">
              #{t}
            </span>
          ))}
        </div>
      </td>
      <td className="px-2 py-2 text-[10px] text-[var(--text-muted)]">
        <div>★ {clip.avg_rating?.toFixed(1) ?? "—"} ({clip.rating_count})</div>
        <div>💬 {clip.comment_count}</div>
      </td>
      <td className="px-2 py-2">
        {clip.kill_visible === false ? (
          <span className="text-[var(--red)] text-xs" title="Masqué du feed">
            ●
          </span>
        ) : (
          <span className="text-[var(--green)] text-xs" title="Visible">
            ●
          </span>
        )}
      </td>
      <td className="px-2 py-2" onClick={(e) => e.stopPropagation()}>
        <Link
          href={`/admin/clips/${clip.id}`}
          className="text-[var(--gold)]/60 hover:text-[var(--gold)] text-xs"
          title="Page complète"
        >
          ↗
        </Link>
      </td>
    </tr>
  );
}

function ClipGridCard({
  clip,
  selected,
  onToggle,
  onOpen,
}: {
  clip: ClipRow;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const sv = statusVariant(clip.status);
  return (
    <div
      className={`rounded-lg border bg-[var(--bg-surface)] overflow-hidden cursor-pointer transition-all ${
        selected
          ? "border-[var(--gold)] ring-2 ring-[var(--gold)]/40"
          : "border-[var(--border-gold)] hover:border-[var(--gold)]/60"
      }`}
      onClick={onOpen}
    >
      <div className="relative aspect-[3/4] bg-black">
        {clip.thumbnail_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={clip.thumbnail_url}
            alt={`${clip.killer_champion} → ${clip.victim_champion}`}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)] text-sm">
            no thumbnail
          </div>
        )}
        <div className="absolute top-1.5 left-1.5 right-1.5 flex items-start justify-between gap-1">
          <input
            type="checkbox"
            checked={selected}
            onClick={(e) => e.stopPropagation()}
            onChange={onToggle}
            className="accent-[var(--gold)]"
            aria-label="Sélectionner"
          />
          <ScoreChip value={clip.highlight_score} />
        </div>
        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex items-end justify-between gap-1">
          <AdminBadge variant={sv.variant} size="sm">
            {sv.label}
          </AdminBadge>
          {clip.multi_kill && (
            <AdminBadge variant="warn" size="sm">
              {clip.multi_kill}
            </AdminBadge>
          )}
        </div>
      </div>
      <div className="p-2 space-y-1">
        <div className="text-xs font-bold truncate">
          <span className="text-[var(--gold)]">{clip.killer_champion}</span>
          <span className="mx-1 text-[var(--text-muted)]">→</span>
          <span>{clip.victim_champion}</span>
        </div>
        <p className="text-[10px] text-[var(--text-secondary)] line-clamp-2 min-h-[1.6em]">
          {clip.ai_description ?? "—"}
        </p>
      </div>
    </div>
  );
}
