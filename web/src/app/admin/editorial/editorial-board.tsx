"use client";

/**
 * EditorialBoard — client-side filter chips + card grid + recent
 * actions sidebar. Kept in one file so the editor doesn't have to
 * jump between three tiny components to follow the wiring.
 *
 * Filter chips are pure client-side : we ship 120 cards once from
 * the server, then narrow them locally. No re-fetches, instant
 * feedback. (If we ever cross 1k cards we'll page server-side.)
 */

import { useMemo, useState } from "react";
import { EditorialCard, type EditorialCardProps } from "./editorial-card";

interface ActionRow {
  id: string;
  action: string;
  kill_id: string | null;
  performed_by: string | null;
  performed_at: string;
  payload: Record<string, unknown> | null;
}

type Filter = "all" | "today" | "high_score" | "multi_kill" | "hidden" | "pinned";

const FILTER_LABELS: Record<Filter, string> = {
  all: "Tous",
  today: "Today",
  high_score: "Score ≥ 8",
  multi_kill: "Multi-kills",
  hidden: "Cachés",
  pinned: "Déjà pinnés",
};

function formatActionTime(iso: string): string {
  const d = new Date(iso);
  const ageMs = Date.now() - d.getTime();
  if (ageMs < 60_000) return "à l'instant";
  if (ageMs < 3_600_000) return `il y a ${Math.floor(ageMs / 60_000)} min`;
  if (ageMs < 86_400_000) return `il y a ${Math.floor(ageMs / 3_600_000)} h`;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

const ACTION_LABELS: Record<string, string> = {
  "feature.pin": "Pin",
  "feature.unpin": "Unpin",
  "discord.push": "Discord",
  "kill.hide": "Hide",
  "kill.unhide": "Unhide",
  "kotw.auto_pick": "KOTW auto",
};

export function EditorialBoard({
  cards,
  actions,
}: {
  cards: EditorialCardProps[];
  actions: ActionRow[];
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const q = search.trim().toLowerCase();
    return cards.filter((c) => {
      if (filter === "today" && !c.createdAt.startsWith(todayStr)) return false;
      if (filter === "high_score" && (c.highlightScore ?? 0) < 8) return false;
      if (filter === "multi_kill" && !c.multiKill) return false;
      if (filter === "hidden" && !c.isHidden) return false;
      if (filter === "pinned" && !c.pinnedFeature) return false;
      if (q) {
        const hay = `${c.killerChampion} ${c.victimChampion} ${c.aiDescription ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [cards, filter, search]);

  const counts: Record<Filter, number> = {
    all: cards.length,
    today: cards.filter((c) => c.createdAt.startsWith(new Date().toISOString().slice(0, 10))).length,
    high_score: cards.filter((c) => (c.highlightScore ?? 0) >= 8).length,
    multi_kill: cards.filter((c) => c.multiKill).length,
    hidden: cards.filter((c) => c.isHidden).length,
    pinned: cards.filter((c) => c.pinnedFeature).length,
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      {/* ── Main column : filters + grid ── */}
      <div>
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="font-display text-2xl font-bold text-[var(--text-primary)]">
            Editorial
          </h1>
          <span className="text-xs text-[var(--text-muted)]">
            {filtered.length} / {cards.length} kills
          </span>
        </div>

        {/* Filter chips */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                filter === f
                  ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)]"
                  : "border-[var(--border-gold)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--gold)]/40"
              }`}
            >
              {FILTER_LABELS[f]} <span className="ml-1 opacity-60">{counts[f]}</span>
            </button>
          ))}
        </div>

        {/* Search */}
        <input
          type="search"
          placeholder="Rechercher champion, description…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="mb-4 w-full rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--gold)]/60 focus:outline-none"
        />

        {/* Card grid */}
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--border-gold)] p-12 text-center text-sm text-[var(--text-muted)]">
            Rien à afficher avec ce filtre.
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((c) => (
              <EditorialCard key={c.id} {...c} />
            ))}
          </div>
        )}
      </div>

      {/* ── Side column : recent actions ── */}
      <aside className="lg:sticky lg:top-20 self-start">
        <h2 className="mb-3 font-display text-xs font-bold uppercase tracking-widest text-[var(--text-muted)]">
          Actions récentes
        </h2>
        {actions.length === 0 ? (
          <p className="text-xs text-[var(--text-muted)]">Aucune action récente.</p>
        ) : (
          <ol className="space-y-2">
            {actions.map((a) => (
              <li
                key={a.id}
                className="rounded border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[var(--gold)]">
                    {ACTION_LABELS[a.action] ?? a.action}
                  </span>
                  <span className="text-[var(--text-muted)]">
                    {formatActionTime(a.performed_at)}
                  </span>
                </div>
                <div className="mt-1 truncate text-[var(--text-secondary)]">
                  {a.performed_by ?? "—"}
                </div>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}

// Re-export for convenience (some imports go through board, some direct).
export { EditorialCard };
