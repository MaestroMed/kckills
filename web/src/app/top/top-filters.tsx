"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

interface Props {
  players: string[];
  champions?: string[];
}

/**
 * URL-based filters for /top. Each filter change updates the URL search
 * params so the page re-fetches with the correct filter applied.
 * This makes filter states shareable + bookmarkable.
 */
export function TopFilters({ players, champions = [] }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const player = searchParams.get("player") ?? "";
  const year = searchParams.get("year") ?? "";
  const champion = searchParams.get("champion") ?? "";
  const multiKill = searchParams.get("multi") ?? "";

  const hasFilters = player || year || champion || multiKill;

  const setFilter = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`/top?${params.toString()}`);
    },
    [router, searchParams]
  );

  const resetAll = useCallback(() => {
    router.push("/top");
  }, [router]);

  return (
    <div className="flex flex-wrap gap-2">
      <select
        value={player}
        onChange={(e) => setFilter("player", e.target.value)}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]"
      >
        <option value="">Tous les joueurs</option>
        {players.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <select
        value={year}
        onChange={(e) => setFilter("year", e.target.value)}
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
          onChange={(e) => setFilter("champion", e.target.value)}
          className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]"
        >
          <option value="">Tous champions</option>
          {champions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      )}

      <select
        value={multiKill}
        onChange={(e) => setFilter("multi", e.target.value)}
        className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-secondary)] outline-none focus:border-[var(--gold)]"
      >
        <option value="">Tous types</option>
        <option value="3">Triple+ (3+ kills)</option>
        <option value="5">Carry (5+ kills)</option>
        <option value="perfect">Perfect (0 deaths)</option>
      </select>

      {hasFilters && (
        <button
          onClick={resetAll}
          className="rounded-lg border border-[var(--red)]/30 px-3 py-2 text-sm text-[var(--red)] hover:bg-[var(--red)]/10 transition-colors"
        >
          Reset
        </button>
      )}
    </div>
  );
}
