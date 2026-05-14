"use client";

/**
 * FormCalendar — KC win/loss calendar over the last N days.
 *
 * Wave 32 — GitHub-contributions-style heat grid where each cell is one
 * day of the past 90. Cells are coloured by KC's outcome that day :
 *
 *   • Played + won every series        → bright gold
 *   • Played + mixed (some wins/loss)  → mid-tone (gold→red gradient)
 *   • Played + lost every series       → red
 *   • Did not play                     → very dim grey
 *
 * Hovering any cell pops a tooltip with the matchups + scores. The
 * footer shows aggregate stats : games played, win rate, biggest
 * single-day haul (most kills in one day).
 *
 * Built from `RealMatch[]` (already loaded on the page) so no extra
 * network round-trip. Pure rendering — the parent just passes matches.
 *
 * Accessibility :
 *   - role="grid" on the container, role="gridcell" on each day
 *   - aria-label on each cell = "DD/MM — X jeux, Y wins, Z losses"
 *   - keyboard nav not added (read-only viz, tab traverses tooltip
 *     trigger via focus-visible)
 *   - prefers-reduced-motion : drop fade-in stagger
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { m, useReducedMotion } from "motion/react";

import type { RealMatch } from "@/lib/real-data";

interface Props {
  matches: RealMatch[];
  /** Days back to render. Default 84 → 12 weeks → 7×12 grid. */
  days?: number;
}

interface DayBucket {
  date: string; // YYYY-MM-DD
  played: boolean;
  wins: number;
  losses: number;
  games: number;
  kills: number;
  opponents: string[];
  matches: { id: string; opponent: string; score: string; won: boolean }[];
}

function toIsoDay(date: Date): string {
  // Normalise to UTC YYYY-MM-DD so day boundaries don't drift with TZ.
  return date.toISOString().slice(0, 10);
}

function buildBuckets(matches: RealMatch[], days: number): DayBucket[] {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const buckets: DayBucket[] = [];
  // Index matches by date for O(1) lookup.
  const byDate = new Map<string, RealMatch[]>();
  for (const m of matches) {
    const d = m.date.slice(0, 10);
    const list = byDate.get(d) ?? [];
    list.push(m);
    byDate.set(d, list);
  }
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    const iso = toIsoDay(d);
    const dayMatches = byDate.get(iso) ?? [];
    let wins = 0;
    let losses = 0;
    let kills = 0;
    let games = 0;
    const opponents: string[] = [];
    const matchInfos: DayBucket["matches"] = [];
    for (const m of dayMatches) {
      if (m.kc_won) wins += 1;
      else losses += 1;
      games += m.games.length;
      for (const g of m.games) kills += g.kc_kills;
      opponents.push(m.opponent.code);
      matchInfos.push({
        id: m.id,
        opponent: m.opponent.code,
        score: `${m.kc_score}-${m.opp_score}`,
        won: m.kc_won,
      });
    }
    buckets.push({
      date: iso,
      played: dayMatches.length > 0,
      wins,
      losses,
      games,
      kills,
      opponents,
      matches: matchInfos,
    });
  }
  return buckets;
}

/** Hex colour for one cell. Stops are tuned to look readable at the
 *  10×10px grid scale + on the dark KCKILLS background. */
function cellColor(b: DayBucket): { bg: string; border: string } {
  if (!b.played) {
    return {
      bg: "rgba(200,170,110,0.04)",
      border: "rgba(200,170,110,0.10)",
    };
  }
  if (b.losses === 0) {
    // Pure win day. Saturation increases with wins (1, 2, 3+).
    const alpha = Math.min(0.95, 0.55 + b.wins * 0.18);
    return {
      bg: `rgba(200,170,110,${alpha})`,
      border: `rgba(200,170,110,${Math.min(1, alpha + 0.1)})`,
    };
  }
  if (b.wins === 0) {
    // Pure loss day.
    const alpha = Math.min(0.85, 0.5 + b.losses * 0.18);
    return {
      bg: `rgba(232,64,87,${alpha})`,
      border: `rgba(232,64,87,${Math.min(1, alpha + 0.1)})`,
    };
  }
  // Mixed day (rare — usually one match per day). Blend gold + red.
  const winShare = b.wins / Math.max(1, b.wins + b.losses);
  // Lerp toward gold when more wins.
  const r = Math.round(200 + (232 - 200) * (1 - winShare));
  const g = Math.round(170 - 70 * (1 - winShare));
  const bl = Math.round(110 - 30 * (1 - winShare));
  return {
    bg: `rgba(${r},${g},${bl},0.7)`,
    border: `rgba(${r},${g},${bl},0.85)`,
  };
}

const dayLabelFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
});

const dayLabelLongFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "long",
});

const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];

export function FormCalendar({ matches, days = 84 }: Props) {
  const reduced = useReducedMotion();
  const [activeDate, setActiveDate] = useState<string | null>(null);

  const buckets = useMemo(() => buildBuckets(matches, days), [matches, days]);

  // Aggregate footer stats
  const agg = useMemo(() => {
    let played = 0;
    let totalWins = 0;
    let totalLosses = 0;
    let totalKills = 0;
    let bestDay: DayBucket | null = null;
    for (const b of buckets) {
      if (!b.played) continue;
      played += 1;
      totalWins += b.wins;
      totalLosses += b.losses;
      totalKills += b.kills;
      if (!bestDay || b.kills > bestDay.kills) bestDay = b;
    }
    const wr =
      totalWins + totalLosses > 0
        ? Math.round((totalWins / (totalWins + totalLosses)) * 100)
        : 0;
    return { played, totalWins, totalLosses, totalKills, bestDay, wr };
  }, [buckets]);

  // Group buckets into weeks (columns of 7). The grid renders week-by-
  // week left to right ; oldest week first. Pad the first week so the
  // grid lines up with Monday on top.
  const weeks = useMemo(() => {
    const cols: DayBucket[][] = [];
    let current: DayBucket[] = [];
    // Find weekday of first bucket — pad leading slots with null sentinels
    if (buckets.length === 0) return cols;
    const firstDate = new Date(buckets[0]!.date + "T00:00:00Z");
    // getUTCDay : 0 Sun → 6 Sat. We want Monday=0 so shift by -1 mod 7.
    let firstWeekday = (firstDate.getUTCDay() + 6) % 7;
    // Pad
    for (let i = 0; i < firstWeekday; i++) {
      current.push({
        date: "",
        played: false,
        wins: 0,
        losses: 0,
        games: 0,
        kills: 0,
        opponents: [],
        matches: [],
      });
    }
    for (const b of buckets) {
      current.push(b);
      if (current.length === 7) {
        cols.push(current);
        current = [];
      }
    }
    if (current.length > 0) {
      // Pad trailing
      while (current.length < 7) {
        current.push({
          date: "",
          played: false,
          wins: 0,
          losses: 0,
          games: 0,
          kills: 0,
          opponents: [],
          matches: [],
        });
      }
      cols.push(current);
    }
    return cols;
  }, [buckets]);

  const activeBucket = useMemo(
    () => buckets.find((b) => b.date === activeDate) ?? null,
    [activeDate, buckets],
  );

  return (
    <section
      className="relative max-w-7xl mx-auto px-4 md:px-6 py-12 md:py-16"
      aria-labelledby="form-calendar-heading"
    >
      <header className="flex flex-wrap items-end justify-between gap-3 mb-6 md:mb-8">
        <div>
          <p className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.35em] text-[var(--gold)]">
            {days} jours de forme
          </p>
          <h2
            id="form-calendar-heading"
            className="font-display text-3xl md:text-5xl font-black uppercase tracking-tight text-white mt-1"
          >
            La forme <span className="text-gold-gradient">KC</span>
          </h2>
          <p className="text-xs md:text-sm text-[var(--text-muted)] mt-2 max-w-xl">
            Chaque carré = un jour. Or saturé = victoire, rouge = défaite,
            sombre = pas de match. Survole une case pour voir les
            matchups du jour.
          </p>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: "rgba(200,170,110,0.04)", borderColor: "rgba(200,170,110,0.2)", borderWidth: 1 }}
            />
            Repos
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: "rgba(200,170,110,0.7)" }}
            />
            Win day
          </span>
          <span className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: "rgba(232,64,87,0.7)" }}
            />
            Loss day
          </span>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_240px]">
        {/* Grid */}
        <div
          role="grid"
          aria-label={`Calendrier KC sur les ${days} derniers jours`}
          className="relative overflow-x-auto"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          <div className="flex items-start gap-1.5">
            {/* Weekday labels (LMMJVSD) */}
            <div
              className="flex flex-col gap-1.5 pt-1 pr-1 shrink-0"
              aria-hidden
            >
              {WEEKDAY_LABELS.map((d, i) => (
                <span
                  key={i}
                  className="h-3.5 leading-none text-[9px] font-data text-[var(--text-disabled)] flex items-center"
                  style={{ width: 10 }}
                >
                  {i % 2 === 0 ? d : ""}
                </span>
              ))}
            </div>
            {/* Weeks (columns) */}
            <div className="flex gap-1.5">
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-1.5">
                  {week.map((b, di) => {
                    const empty = b.date === "";
                    const { bg, border } = cellColor(b);
                    const isActive = activeDate === b.date && !empty;
                    const labelDate = empty
                      ? ""
                      : dayLabelLongFmt.format(new Date(b.date + "T00:00:00Z"));
                    const aria = empty
                      ? undefined
                      : b.played
                        ? `${labelDate} — ${b.wins} victoire${b.wins > 1 ? "s" : ""}, ${b.losses} défaite${b.losses > 1 ? "s" : ""}, ${b.kills} kills`
                        : `${labelDate} — Pas de match`;
                    return (
                      <m.button
                        key={`${wi}-${di}`}
                        type="button"
                        role="gridcell"
                        aria-label={aria}
                        onMouseEnter={() => !empty && setActiveDate(b.date)}
                        onFocus={() => !empty && setActiveDate(b.date)}
                        onClick={() => {
                          if (empty) return;
                          setActiveDate(b.date === activeDate ? null : b.date);
                        }}
                        disabled={empty}
                        initial={reduced ? false : { opacity: 0, scale: 0.4 }}
                        animate={{ opacity: empty ? 0 : 1, scale: 1 }}
                        transition={
                          reduced
                            ? { duration: 0 }
                            : {
                                duration: 0.3,
                                delay: 0.002 * (wi * 7 + di),
                                ease: "easeOut",
                              }
                        }
                        className="h-3.5 w-3.5 rounded-sm transition-transform hover:scale-150 hover:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] disabled:cursor-default"
                        style={{
                          backgroundColor: bg,
                          border: `1px solid ${border}`,
                          boxShadow: isActive
                            ? `0 0 0 2px var(--gold), 0 0 14px ${bg}`
                            : undefined,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* Aggregate stats below the grid */}
          <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <KpiBlock label="Jours joués" value={String(agg.played)} />
            <KpiBlock
              label="Bilan"
              value={
                <>
                  <span className="text-[var(--green)]">{agg.totalWins}</span>
                  <span className="text-[var(--text-muted)] mx-1">/</span>
                  <span className="text-[var(--red)]">{agg.totalLosses}</span>
                </>
              }
            />
            <KpiBlock
              label="Winrate"
              value={
                <span
                  style={{
                    color:
                      agg.wr >= 65
                        ? "var(--green)"
                        : agg.wr >= 50
                          ? "var(--gold)"
                          : "var(--red)",
                  }}
                >
                  {agg.wr}%
                </span>
              }
            />
            <KpiBlock
              label="Best day · kills"
              value={
                agg.bestDay
                  ? `${agg.bestDay.kills}`
                  : "—"
              }
              hint={
                agg.bestDay
                  ? dayLabelFmt.format(new Date(agg.bestDay.date + "T00:00:00Z"))
                  : undefined
              }
            />
          </div>
        </div>

        {/* Hover/click panel — shows active day's matches */}
        <aside className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 self-start sticky top-4">
          {activeBucket ? (
            <ActiveDayPanel bucket={activeBucket} />
          ) : (
            <EmptyHint />
          )}
        </aside>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Subcomponents
// ════════════════════════════════════════════════════════════════════

function KpiBlock({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p className="font-data text-xl font-black tabular-nums mt-1 text-[var(--text-primary)]">
        {value}
      </p>
      {hint && (
        <p className="text-[10px] text-[var(--text-disabled)] mt-0.5">
          {hint}
        </p>
      )}
    </div>
  );
}

function ActiveDayPanel({ bucket }: { bucket: DayBucket }) {
  const date = new Date(bucket.date + "T00:00:00Z");
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {dayLabelLongFmt.format(date)}
      </p>
      {!bucket.played ? (
        <p className="mt-2 text-sm italic text-[var(--text-muted)]">
          Aucun match ce jour. La meute dort.
        </p>
      ) : (
        <>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-data text-3xl font-black tabular-nums text-[var(--gold)]">
              {bucket.kills}
            </span>
            <span className="text-xs text-[var(--text-muted)] uppercase tracking-widest">
              kills · {bucket.games} game{bucket.games > 1 ? "s" : ""}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-[var(--text-secondary)]">
            <span className="text-[var(--green)] font-bold">{bucket.wins} W</span>
            <span className="mx-1 text-[var(--text-disabled)]">·</span>
            <span className="text-[var(--red)] font-bold">{bucket.losses} L</span>
          </p>
          <ul className="mt-3 space-y-1">
            {bucket.matches.map((m) => (
              <li key={m.id}>
                <Link
                  href={`/match/${m.id}`}
                  className="flex items-center justify-between text-xs hover:bg-[var(--bg-elevated)]/50 rounded px-1.5 py-1 -mx-1.5"
                >
                  <span className="text-[var(--text-secondary)]">
                    <span className="text-[var(--gold)] font-bold">KC</span>{" "}
                    <span className="text-[var(--text-muted)]">vs</span>{" "}
                    <span className="font-semibold">{m.opponent}</span>
                  </span>
                  <span
                    className="font-data text-[11px] tabular-nums font-bold"
                    style={{
                      color: m.won ? "var(--green)" : "var(--red)",
                    }}
                  >
                    {m.score}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        Détail du jour
      </p>
      <p className="mt-2 text-sm italic text-[var(--text-muted)]">
        Survole une case du calendrier pour voir les matchs du jour.
      </p>
      <p className="mt-3 text-[10px] text-[var(--text-disabled)]">
        Astuce : sur mobile, tape une case pour épingler le détail.
      </p>
    </div>
  );
}
