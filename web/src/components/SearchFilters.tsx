"use client";

import { useState } from "react";

interface SearchFiltersProps {
  players: string[];
  onFilter?: (filters: FilterState) => void;
}

export interface FilterState {
  player: string;
  involvement: string;
  era: string;
  minKills: number;
  query: string;
}

const ERAS = [
  { id: "", label: "Toutes les eres" },
  { id: "2026", label: "2026" },
  { id: "2025", label: "2025" },
  { id: "2024", label: "2024" },
];

const INVOLVEMENTS = [
  { id: "", label: "Tous" },
  { id: "killer", label: "KC Killer" },
  { id: "victim", label: "KC Victim" },
];

export function SearchFilters({ players, onFilter }: SearchFiltersProps) {
  const [filters, setFilters] = useState<FilterState>({
    player: "",
    involvement: "",
    era: "",
    minKills: 0,
    query: "",
  });

  const update = (patch: Partial<FilterState>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    onFilter?.(next);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {/* Search */}
      <input
        type="text"
        placeholder="Rechercher..."
        value={filters.query}
        onChange={(e) => update({ query: e.target.value })}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-[var(--gold)] w-48"
      />

      {/* Player filter */}
      <select
        value={filters.player}
        onChange={(e) => update({ player: e.target.value })}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none"
      >
        <option value="">Tous les joueurs</option>
        {players.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      {/* Era */}
      <select
        value={filters.era}
        onChange={(e) => update({ era: e.target.value })}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none"
      >
        {ERAS.map((era) => (
          <option key={era.id} value={era.id}>{era.label}</option>
        ))}
      </select>

      {/* Involvement */}
      <select
        value={filters.involvement}
        onChange={(e) => update({ involvement: e.target.value })}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none"
      >
        {INVOLVEMENTS.map((inv) => (
          <option key={inv.id} value={inv.id}>{inv.label}</option>
        ))}
      </select>

      {/* Min kills */}
      <select
        value={filters.minKills}
        onChange={(e) => update({ minKills: Number(e.target.value) })}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none"
      >
        <option value={0}>Min kills: 0</option>
        <option value={3}>Min kills: 3+</option>
        <option value={5}>Min kills: 5+</option>
        <option value={8}>Min kills: 8+</option>
      </select>

      {/* Reset */}
      {(filters.player || filters.era || filters.involvement || filters.minKills > 0 || filters.query) && (
        <button
          onClick={() => update({ player: "", era: "", involvement: "", minKills: 0, query: "" })}
          className="rounded-lg border border-[var(--red)]/30 px-3 py-2 text-sm text-[var(--red)] hover:bg-[var(--red)]/10"
        >
          Reset
        </button>
      )}
    </div>
  );
}
