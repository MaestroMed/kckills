"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import Link from "next/link";
import { ScoreChip } from "@/components/admin/ScoreChip";

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
  created_at: string;
  updated_at: string;
  games: {
    game_number: number;
    matches: { external_id: string; stage: string | null; scheduled_at: string | null } | null;
  } | null;
}

const FIGHT_TYPES = [
  "solo_kill", "pick", "gank", "skirmish_2v2", "skirmish_3v3",
  "teamfight_4v4", "teamfight_5v5",
];

const SORTS = [
  { value: "score_desc", label: "Score ↓" },
  { value: "score_asc", label: "Score ↑" },
  { value: "recent", label: "Plus récent" },
  { value: "oldest", label: "Plus ancien" },
  { value: "rating", label: "Rating" },
  { value: "comments", label: "Commentaires" },
];

const SAVED_VIEWS = [
  { id: "all", label: "Tout", params: {} },
  { id: "no_description", label: "Sans description", params: { has_description: "false" } },
  { id: "low_score", label: "Score < 5", params: { max_score: "5" } },
  { id: "high_score", label: "Score ≥ 8", params: { min_score: "8" } },
  { id: "hidden", label: "Masqués", params: { hidden: "only" } },
  { id: "needs_reclip", label: "À re-clip", params: { /* TODO server flag */ } },
];

export function ClipsLibrary() {
  const [clips, setClips] = useState<ClipRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [fightTypes, setFightTypes] = useState<string[]>([]);
  const [hidden, setHidden] = useState<string>("false"); // exclude hidden by default
  const [hasDescription, setHasDescription] = useState<string>("");
  const [minScore, setMinScore] = useState<string>("");
  const [maxScore, setMaxScore] = useState<string>("");
  const [involvement, setInvolvement] = useState<string>("team_killer");
  const [sort, setSort] = useState("score_desc");
  const [limit, setLimit] = useState(100);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activeView, setActiveView] = useState("all");

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setQDebounced(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  const fetchClips = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (qDebounced) params.set("q", qDebounced);
    fightTypes.forEach((ft) => params.append("fight_type", ft));
    if (hidden) params.set("hidden", hidden);
    if (hasDescription) params.set("has_description", hasDescription);
    if (minScore) params.set("min_score", minScore);
    if (maxScore) params.set("max_score", maxScore);
    if (involvement) params.set("involvement", involvement);
    params.set("sort", sort);
    params.set("limit", String(limit));

    try {
      const r = await fetch(`/api/admin/clips?${params}`);
      if (r.ok) {
        const data = await r.json();
        setClips(data.items ?? []);
        setTotal(data.total ?? 0);
      }
    } finally {
      setLoading(false);
    }
  }, [qDebounced, fightTypes, hidden, hasDescription, minScore, maxScore, involvement, sort, limit]);

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

  const selectAll = () => {
    setSelected(new Set(clips.map((c) => c.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const applyView = (view: typeof SAVED_VIEWS[number]) => {
    setActiveView(view.id);
    setHidden(view.params.hidden ?? "false");
    setHasDescription(view.params.has_description ?? "");
    setMinScore(view.params.min_score ?? "");
    setMaxScore(view.params.max_score ?? "");
    setFightTypes([]);
    setQ("");
  };

  const runBulk = async (action: string, payload?: unknown) => {
    if (selected.size === 0) return;
    if (!confirm(`${action} sur ${selected.size} clip(s) ?`)) return;
    const r = await fetch("/api/admin/clips/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selected], action, payload }),
    });
    if (r.ok) {
      clearSelection();
      void fetchClips();
    } else {
      const err = await r.json();
      alert(`Erreur: ${err.error}`);
    }
  };

  const toggleFightType = (ft: string) => {
    setFightTypes((prev) => (prev.includes(ft) ? prev.filter((x) => x !== ft) : [...prev, ft]));
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-black text-[var(--gold)]">Clip Library</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {total} clips · {selected.size > 0 ? `${selected.size} selectionnés` : "aucune sélection"}
          </p>
        </div>
      </div>

      {/* Saved views */}
      <div className="flex flex-wrap gap-1.5">
        {SAVED_VIEWS.map((v) => (
          <button
            key={v.id}
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

      {/* Filters bar */}
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search dans description / champions / tags..."
            className="flex-1 min-w-[240px] rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-1.5 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--gold)]"
          />

          <select
            value={involvement}
            onChange={(e) => setInvolvement(e.target.value)}
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          >
            <option value="team_killer">KC kills</option>
            <option value="team_victim">KC deaths</option>
            <option value="any">Tous</option>
          </select>

          <select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          >
            {SORTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <select
            value={hidden}
            onChange={(e) => setHidden(e.target.value)}
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          >
            <option value="false">Visibles + masqués</option>
            <option value="true">Visibles uniquement</option>
            <option value="only">Masqués uniquement</option>
          </select>

          <select
            value={hasDescription}
            onChange={(e) => setHasDescription(e.target.value)}
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          >
            <option value="">Avec/sans description</option>
            <option value="true">Avec description</option>
            <option value="false">Sans description</option>
          </select>

          <input
            type="number"
            min={1}
            max={10}
            step={0.5}
            placeholder="Min"
            value={minScore}
            onChange={(e) => setMinScore(e.target.value)}
            className="w-16 rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          />
          <input
            type="number"
            min={1}
            max={10}
            step={0.5}
            placeholder="Max"
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
            className="w-16 rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
          />

          <input
            type="number"
            min={10}
            max={500}
            step={50}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-16 rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs"
            title="Limit"
          />
        </div>

        <div className="flex flex-wrap gap-1">
          {FIGHT_TYPES.map((ft) => (
            <button
              key={ft}
              onClick={() => toggleFightType(ft)}
              className={`rounded-full px-2 py-0.5 text-[10px] font-bold border transition-all ${
                fightTypes.includes(ft)
                  ? "bg-[var(--gold)]/20 border-[var(--gold)] text-[var(--gold)]"
                  : "border-[var(--border-gold)]/50 text-[var(--text-disabled)] hover:text-[var(--text-muted)]"
              }`}
            >
              {ft}
            </button>
          ))}
        </div>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="sticky top-14 z-10 rounded-xl border border-[var(--gold)]/40 bg-[var(--gold)]/10 backdrop-blur-md p-3 flex items-center gap-2">
          <span className="text-xs font-bold text-[var(--gold)]">{selected.size} clip(s) sélectionnés:</span>
          <button onClick={() => runBulk("hide")} className="rounded-md bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)] px-3 py-1 text-xs font-bold hover:bg-[var(--red)]/30">Masquer</button>
          <button onClick={() => runBulk("unhide")} className="rounded-md bg-[var(--green)]/20 border border-[var(--green)]/40 text-[var(--green)] px-3 py-1 text-xs font-bold hover:bg-[var(--green)]/30">Afficher</button>
          <button onClick={() => runBulk("mark_reanalyze")} className="rounded-md bg-[var(--blue-kc)]/20 border border-[var(--blue-kc)]/40 text-[var(--blue-kc)] px-3 py-1 text-xs font-bold">Ré-analyser</button>
          <button onClick={() => runBulk("mark_reclip", { reason: "bulk admin flag" })} className="rounded-md bg-[var(--orange)]/20 border border-[var(--orange)]/40 text-[var(--orange)] px-3 py-1 text-xs font-bold">Marquer re-clip</button>
          <select
            onChange={(e) => { if (e.target.value) { runBulk("set_fight_type", { fight_type: e.target.value }); e.target.value = ""; } }}
            className="rounded-md border border-[var(--border-gold)] bg-[var(--bg-primary)] px-2 py-1 text-xs"
            defaultValue=""
          >
            <option value="">Fight type →</option>
            {FIGHT_TYPES.map((ft) => <option key={ft} value={ft}>{ft}</option>)}
          </select>
          <button onClick={clearSelection} className="ml-auto text-xs text-[var(--text-muted)] hover:text-[var(--gold)]">Désélectionner</button>
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-[var(--bg-elevated)] border-b border-[var(--border-gold)] text-left">
            <tr>
              <th className="px-2 py-2 w-8">
                <input
                  type="checkbox"
                  checked={selected.size > 0 && selected.size === clips.length}
                  onChange={() => (selected.size === clips.length ? clearSelection() : selectAll())}
                  className="accent-[var(--gold)]"
                />
              </th>
              <th className="px-2 py-2 w-20">Clip</th>
              <th className="px-2 py-2">Kill</th>
              <th className="px-2 py-2 w-32">Match</th>
              <th className="px-2 py-2 w-14">Time</th>
              <th className="px-2 py-2 w-28">Type</th>
              <th className="px-2 py-2 w-14">Score</th>
              <th className="px-2 py-2">Description</th>
              <th className="px-2 py-2 w-20">Stats</th>
              <th className="px-2 py-2 w-12">Vis.</th>
              <th className="px-2 py-2 w-16">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-[var(--text-muted)]">Chargement...</td></tr>
            ) : clips.length === 0 ? (
              <tr><td colSpan={11} className="px-4 py-8 text-center text-[var(--text-muted)]">Aucun clip</td></tr>
            ) : (
              clips.map((c) => (
                <ClipRowView key={c.id} clip={c} selected={selected.has(c.id)} onToggle={() => toggleSelect(c.id)} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClipRowView({ clip, selected, onToggle }: { clip: ClipRow; selected: boolean; onToggle: () => void }) {
  const gt = clip.game_time_seconds ?? 0;
  const match = clip.games?.matches;
  const date = match?.scheduled_at?.slice(0, 10) ?? "—";

  return (
    <tr className={`border-b border-[var(--border-gold)]/20 hover:bg-[var(--bg-elevated)]/40 ${selected ? "bg-[var(--gold)]/5" : ""}`}>
      <td className="px-2 py-2">
        <input type="checkbox" checked={selected} onChange={onToggle} className="accent-[var(--gold)]" />
      </td>
      <td className="px-2 py-2">
        {clip.thumbnail_url ? (
          <div className="relative w-14 h-24 rounded overflow-hidden bg-black">
            <img src={clip.thumbnail_url} alt="" className="w-full h-full object-cover" loading="lazy" />
            {clip.multi_kill && (
              <span className="absolute top-0.5 right-0.5 rounded bg-[var(--orange)] text-[8px] font-black text-black px-1">
                {clip.multi_kill[0].toUpperCase()}
              </span>
            )}
          </div>
        ) : (
          <div className="w-14 h-24 rounded bg-[var(--bg-elevated)] flex items-center justify-center text-[var(--text-disabled)]">?</div>
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
        <div>{match?.stage ?? "LEC"} G{clip.games?.game_number}</div>
      </td>
      <td className="px-2 py-2 font-mono text-[10px]">{Math.floor(gt / 60)}:{(gt % 60).toString().padStart(2, "0")}</td>
      <td className="px-2 py-2"><span className="text-[10px] font-mono">{clip.fight_type ?? "—"}</span></td>
      <td className="px-2 py-2"><ScoreChip value={clip.highlight_score} /></td>
      <td className="px-2 py-2">
        <div className="line-clamp-2 text-[11px] text-[var(--text-secondary)] max-w-md">{clip.ai_description ?? "—"}</div>
        <div className="flex gap-0.5 mt-0.5 flex-wrap">
          {(clip.ai_tags ?? []).slice(0, 3).map((t) => (
            <span key={t} className="text-[9px] text-[var(--text-muted)]">#{t}</span>
          ))}
        </div>
      </td>
      <td className="px-2 py-2 text-[10px] text-[var(--text-muted)]">
        <div>★ {clip.avg_rating?.toFixed(1) ?? "—"} ({clip.rating_count})</div>
        <div>💬 {clip.comment_count}</div>
      </td>
      <td className="px-2 py-2">
        {clip.kill_visible === false ? (
          <span className="text-[var(--red)] text-xs" title="Masqué du feed">●</span>
        ) : (
          <span className="text-[var(--green)] text-xs" title="Visible">●</span>
        )}
      </td>
      <td className="px-2 py-2">
        <Link href={`/admin/clips/${clip.id}`} className="text-[var(--gold)] hover:underline text-xs">Editer</Link>
      </td>
    </tr>
  );
}
