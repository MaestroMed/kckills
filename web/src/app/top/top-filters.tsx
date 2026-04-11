"use client";

import { useState } from "react";

interface Props {
  players: string[];
  champions?: string[];
}

export function TopFilters({ players, champions = [] }: Props) {
  const [player, setPlayer] = useState("");
  const [year, setYear] = useState("");
  const [champion, setChampion] = useState("");
  const [multiKill, setMultiKill] = useState("");

  const hasFilters = player || year || champion || multiKill;

  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={player}
        onChange={(e) => setPlayer(e.target.value)}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]"
      >
        <option value="">Tous les joueurs</option>
        {players.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>

      <select
        value={year}
        onChange={(e) => setYear(e.target.value)}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]"
      >
        <option value="">Toutes saisons</option>
        <option value="2026">2026</option>
        <option value="2025">2025</option>
        <option value="2024">2024</option>
      </select>

      {champions.length > 0 && (
        <select
          value={champion}
          onChange={(e) => setChampion(e.target.value)}
          className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]"
        >
          <option value="">Tous champions</option>
          {champions.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      )}

      <select
        value={multiKill}
        onChange={(e) => setMultiKill(e.target.value)}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]"
      >
        <option value="">Tous types</option>
        <option value="3">Triple+ (3+ kills)</option>
        <option value="5">Carry (5+ kills)</option>
        <option value="perfect">Perfect (0 deaths)</option>
      </select>

      {hasFilters && (
        <button
          onClick={() => { setPlayer(""); setYear(""); setChampion(""); setMultiKill(""); }}
          className="rounded-lg border border-[var(--red)]/30 px-3 py-2 text-sm text-[var(--red)] hover:bg-[var(--red)]/10"
        >
          Reset
        </button>
      )}
    </div>
  );
}
