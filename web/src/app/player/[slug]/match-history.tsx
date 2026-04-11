"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { championIconUrl } from "@/lib/constants";

interface HistoryEntry {
  matchId: string;
  date: string;
  opponent: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  won: boolean;
}

export function MatchHistory({ history }: { history: HistoryEntry[] }) {
  const [champFilter, setChampFilter] = useState("");
  const [resultFilter, setResultFilter] = useState<"" | "won" | "lost">("");
  const [yearFilter, setYearFilter] = useState("");
  const [showAll, setShowAll] = useState(false);

  const champions = [...new Set(history.map((m) => m.champion))].sort();
  const years = [...new Set(history.map((m) => m.date.slice(0, 4)))].sort().reverse();

  const filtered = history.filter((m) => {
    if (champFilter && m.champion !== champFilter) return false;
    if (resultFilter === "won" && !m.won) return false;
    if (resultFilter === "lost" && m.won) return false;
    if (yearFilter && !m.date.startsWith(yearFilter)) return false;
    return true;
  });

  const displayed = showAll ? filtered : filtered.slice(0, 20);
  const hasFilters = champFilter || resultFilter || yearFilter;

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold">Historique des matchs</h2>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3">
        <select
          value={champFilter}
          onChange={(e) => setChampFilter(e.target.value)}
          className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] outline-none"
        >
          <option value="">Tous champions</option>
          {champions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>

        <select
          value={resultFilter}
          onChange={(e) => setResultFilter(e.target.value as "" | "won" | "lost")}
          className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] outline-none"
        >
          <option value="">W + L</option>
          <option value="won">Victoires</option>
          <option value="lost">D&eacute;faites</option>
        </select>

        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs text-[var(--text-secondary)] outline-none"
        >
          <option value="">Toutes saisons</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>

        {hasFilters && (
          <button
            onClick={() => { setChampFilter(""); setResultFilter(""); setYearFilter(""); }}
            className="rounded-lg border border-[var(--red)]/30 px-3 py-1.5 text-xs text-[var(--red)] hover:bg-[var(--red)]/10"
          >
            Reset
          </button>
        )}

        <span className="text-[10px] text-[var(--text-disabled)] self-center ml-auto">
          {filtered.length} match{filtered.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="space-y-1.5">
        {displayed.map((m, i) => (
          <Link
            key={`${m.matchId}-${i}`}
            href={`/match/${m.matchId}`}
            className="match-row flex items-center gap-3 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3"
          >
            <div className={`flex h-8 w-8 items-center justify-center rounded-md text-xs font-bold ${m.won ? "bg-[var(--green)]/20 text-[var(--green)]" : "bg-[var(--red)]/20 text-[var(--red)]"}`}>
              {m.won ? "W" : "L"}
            </div>
            <Image src={championIconUrl(m.champion)} alt={m.champion} width={28} height={28}
              className="rounded-full border border-[var(--border-gold)]" data-tooltip={m.champion} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                vs {m.opponent} &middot; {m.champion}
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">
                {new Date(m.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
              </p>
            </div>
            <p className="font-data text-sm">
              <span className="text-[var(--green)]">{m.kills}</span>/
              <span className="text-[var(--red)]">{m.deaths}</span>/
              <span>{m.assists}</span>
            </p>
          </Link>
        ))}
      </div>

      {!showAll && filtered.length > 20 && (
        <button
          onClick={() => setShowAll(true)}
          className="mt-3 w-full rounded-lg border border-[var(--border-gold)] py-2 text-xs text-[var(--text-muted)] hover:border-[var(--gold)]/40 hover:text-[var(--gold)]"
        >
          Afficher tout ({filtered.length} matchs)
        </button>
      )}
    </section>
  );
}
