"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { KC_LOGO, TEAM_LOGOS } from "@/lib/kc-assets";

interface MatchSummary {
  id: string;
  opponent: { code: string; name: string };
  kc_won: boolean;
  kc_score: number;
  opp_score: number;
  stage: string;
  best_of: number;
  date: string;
  totalKc: number;
  totalOpp: number;
  hasGames: boolean;
  clipCount?: number;
}

interface YearGroup {
  year: string;
  matches: MatchSummary[];
}

export function MatchesAccordion({ years }: { years: YearGroup[] }) {
  // Most recent year open by default
  const [openYears, setOpenYears] = useState<Set<string>>(
    new Set(years.length > 0 ? [years[0].year] : [])
  );
  const [filter, setFilter] = useState("");

  const toggle = (year: string) => {
    setOpenYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Filter */}
      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Filtrer par adversaire..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="flex-1 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder-[var(--text-disabled)] outline-none focus:border-[var(--gold)]"
        />
        {filter && (
          <button
            onClick={() => setFilter("")}
            className="rounded-lg border border-[var(--red)]/30 px-3 py-2 text-sm text-[var(--red)] hover:bg-[var(--red)]/10"
          >
            Reset
          </button>
        )}
      </div>

      {years.map(({ year, matches }) => {
        const filtered = filter
          ? matches.filter((m) =>
              m.opponent.code.toLowerCase().includes(filter.toLowerCase()) ||
              m.opponent.name.toLowerCase().includes(filter.toLowerCase())
            )
          : matches;

        if (filter && filtered.length === 0) return null;

        const isOpen = openYears.has(year);
        const wins = filtered.filter((m) => m.kc_won).length;
        const losses = filtered.length - wins;

        return (
          <section key={year}>
            <button
              onClick={() => toggle(year)}
              className="w-full flex items-center gap-3 mb-2 group"
            >
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--gold)]/20 to-transparent" />
              <div className="flex items-center gap-2">
                <h2 className="font-display text-lg font-bold text-[var(--gold)]">{year}</h2>
                <span className="font-data text-[10px] text-[var(--text-muted)]">
                  {filtered.length} matchs &middot; {wins}W-{losses}L
                </span>
                <svg
                  className={`h-4 w-4 text-[var(--text-muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
                  fill="none" stroke="currentColor" viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
              <div className="h-px flex-1 bg-gradient-to-r from-transparent via-[var(--gold)]/20 to-transparent" />
            </button>

            {isOpen && (
              <div className="space-y-1.5">
                {filtered.map((match) => (
                  <Link
                    key={match.id}
                    href={`/match/${match.id}`}
                    className="match-row flex items-center justify-between rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold ${match.kc_won ? "bg-[var(--green)]/20 text-[var(--green)]" : "bg-[var(--red)]/20 text-[var(--red)]"}`}>
                        {match.kc_won ? "W" : "L"}
                      </div>
                      <Image src={KC_LOGO} alt="KC" width={22} height={22} className="rounded" />
                      <span className="text-[10px] text-[var(--text-disabled)]">vs</span>
                      {TEAM_LOGOS[match.opponent.code] ? (
                        <Image src={TEAM_LOGOS[match.opponent.code]} alt={match.opponent.code} width={22} height={22} className="rounded" />
                      ) : (
                        <span className="text-xs font-bold text-[var(--text-muted)]">{match.opponent.code}</span>
                      )}
                      <div>
                        <p className="text-sm font-medium">
                          KC vs {match.opponent.code}
                          <span className="ml-2 font-data text-xs text-[var(--text-muted)]">{match.kc_score}-{match.opp_score}</span>
                        </p>
                        <p className="text-[10px] text-[var(--text-muted)]">{match.stage} &middot; Bo{match.best_of}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {(match.clipCount ?? 0) > 0 && (
                        <span className="badge-glass rounded-md px-2 py-0.5 text-[9px] font-bold text-[var(--gold)]">
                          {match.clipCount} clips
                        </span>
                      )}
                      <div className="text-right">
                        {match.hasGames && (
                          <p className="font-data text-xs">
                            <span className="text-[var(--green)]">{match.totalKc}</span>
                            <span className="text-[var(--text-muted)]">-</span>
                            <span className="text-[var(--red)]">{match.totalOpp}</span>
                          </p>
                        )}
                        <p className="text-[10px] text-[var(--text-muted)]">
                          {new Date(match.date).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
