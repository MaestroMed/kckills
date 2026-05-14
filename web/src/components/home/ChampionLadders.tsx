"use client";

/**
 * ChampionLadders — Wave 32 dual ladder of KC champion stats.
 *
 * Two side-by-side leaderboards :
 *   • "Champions KC favoris" — top 10 champions PICKED by KC players,
 *     ordered by games played. Click → /scroll?killerChampion=X.
 *   • "Cibles préférées"     — top 10 ENEMY champions KC has eliminated
 *     most often. Click → /scroll?victimChampion=X.
 *
 * Animated horizontal bars (gold for picks, cyan for kills) grow from
 * 0 → 100% on scroll-into-view. Hover lifts the row and saturates the
 * champion icon. Mobile stacks the two ladders ; desktop renders them
 * in two columns.
 *
 * Data comes from RealMatch[] already loaded on the page — pure
 * aggregation, no extra network.
 *
 * Accessibility :
 *   - <ol> + <li> for both ladders (real list semantics)
 *   - Each row is a <Link> so keyboard tab works naturally
 *   - aria-label per row : "Vi — 23 games"
 *   - prefers-reduced-motion : bars snap into place instantly
 */

import Link from "next/link";
import Image from "next/image";
import { useMemo } from "react";
import { m, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";

import type { RealMatch } from "@/lib/real-data";
import { championIconUrl } from "@/lib/constants";

interface Props {
  matches: RealMatch[];
  /** Top N to render in each ladder. Default 10. */
  top?: number;
}

interface ChampionRow {
  name: string;
  count: number;
}

function topPickedKc(matches: RealMatch[], top: number): ChampionRow[] {
  const tally = new Map<string, number>();
  for (const m of matches) {
    for (const g of m.games) {
      for (const p of g.kc_players) {
        // We only count actual KC players, not benched / loaned roster slots.
        if (!p.name.startsWith("KC ")) continue;
        if (!p.champion) continue;
        tally.set(p.champion, (tally.get(p.champion) ?? 0) + 1);
      }
    }
  }
  return [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

function topVictimChampions(matches: RealMatch[], top: number): ChampionRow[] {
  // Counts how often each ENEMY champion died — proxy = enemy total
  // deaths per champion-game. Since we don't have per-kill records here
  // (those live in the DB), we use opp_kills aggregated by opponent
  // champion as a "got killed lots" signal.
  //
  // For an enemy player with `deaths` deaths in a game, we add `deaths`
  // to their champion's tally. That way "we kill Akali a lot" surfaces
  // even when the opponent rotates rosters.
  const tally = new Map<string, number>();
  for (const m of matches) {
    for (const g of m.games) {
      for (const p of g.opp_players) {
        if (!p.champion) continue;
        const d = Number(p.deaths) || 0;
        if (d <= 0) continue;
        tally.set(p.champion, (tally.get(p.champion) ?? 0) + d);
      }
    }
  }
  return [...tally.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, top);
}

export function ChampionLadders({ matches, top = 10 }: Props) {
  const picked = useMemo(() => topPickedKc(matches, top), [matches, top]);
  const victims = useMemo(() => topVictimChampions(matches, top), [matches, top]);

  if (picked.length === 0 && victims.length === 0) return null;

  return (
    <section
      className="relative max-w-7xl mx-auto px-4 md:px-6 py-12 md:py-16"
      aria-labelledby="champion-ladders-heading"
    >
      <header className="mb-6 md:mb-8">
        <p className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.35em] text-[var(--gold)]">
          Méta KC
        </p>
        <h2
          id="champion-ladders-heading"
          className="font-display text-3xl md:text-5xl font-black uppercase tracking-tight text-white mt-1"
        >
          Les <span className="text-gold-gradient">favoris</span> et les{" "}
          <span style={{ color: "var(--cyan)" }}>cibles</span>
        </h2>
        <p className="text-xs md:text-sm text-[var(--text-muted)] mt-2 max-w-xl">
          À gauche : les champions que les joueurs KC sortent le plus souvent.
          À droite : les champions adverses qui crèvent le plus contre KC.
          Tape une rangée pour filtrer le scroll sur ce champion.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Ladder
          title="Champions KC favoris"
          subtitle="Triés par games jouées"
          rows={picked}
          tone="gold"
          linkPrefix="/scroll?killerChampion="
        />
        <Ladder
          title="Cibles préférées"
          subtitle="Adversaires qui meurent le plus"
          rows={victims}
          tone="cyan"
          linkPrefix="/scroll?victimChampion="
        />
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Ladder column
// ════════════════════════════════════════════════════════════════════

interface LadderProps {
  title: string;
  subtitle: string;
  rows: ChampionRow[];
  tone: "gold" | "cyan";
  linkPrefix: string;
}

function Ladder({ title, subtitle, rows, tone, linkPrefix }: LadderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.2 });
  const reduced = useReducedMotion();
  const color = tone === "gold" ? "var(--gold)" : "var(--cyan)";

  const max = rows[0]?.count ?? 1;

  return (
    <div
      ref={ref}
      className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5"
      style={{
        boxShadow: `inset 0 0 0 1px ${color}10, 0 0 40px -28px ${color}55`,
      }}
    >
      <header className="mb-4 flex items-baseline justify-between gap-3">
        <h3 className="font-display text-base md:text-lg font-bold uppercase tracking-wider text-white">
          {title}
        </h3>
        <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)] text-right">
          {subtitle}
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="text-sm text-[var(--text-muted)] italic text-center py-8">
          Pas encore de données.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((c, i) => {
            const pct = (c.count / max) * 100;
            return (
              <li key={c.name}>
                <Link
                  href={`${linkPrefix}${encodeURIComponent(c.name)}`}
                  aria-label={`${c.name} — ${c.count} ${tone === "gold" ? "games" : "kills subis"}`}
                  className="group relative flex items-center gap-3 rounded-lg overflow-hidden px-2 py-1.5 transition-all hover:bg-[var(--bg-elevated)]/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
                >
                  {/* Bar fill behind everything */}
                  <m.span
                    aria-hidden
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={inView ? { scaleX: 1 } : undefined}
                    transition={{
                      duration: reduced ? 0 : 0.9,
                      delay: reduced ? 0 : 0.05 * i,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="absolute inset-y-0 left-0 origin-left rounded-lg"
                    style={{
                      width: `${pct}%`,
                      background: `linear-gradient(90deg, ${color}33, ${color}11)`,
                      borderRight: `2px solid ${color}aa`,
                    }}
                  />
                  {/* Rank */}
                  <span
                    aria-hidden
                    className="relative font-data text-[10px] font-bold tabular-nums w-5 text-right text-[var(--text-disabled)] group-hover:text-[var(--text-muted)]"
                  >
                    {i + 1}
                  </span>
                  {/* Champion icon */}
                  <span
                    className="relative h-7 w-7 md:h-8 md:w-8 rounded-md overflow-hidden border shrink-0"
                    style={{
                      borderColor: `${color}55`,
                      filter: "grayscale(20%)",
                    }}
                  >
                    <Image
                      src={championIconUrl(c.name)}
                      alt=""
                      fill
                      sizes="32px"
                      className="object-cover transition-all group-hover:grayscale-0 group-hover:scale-105"
                    />
                  </span>
                  {/* Champion name */}
                  <span className="relative flex-1 font-display text-sm font-semibold text-white truncate">
                    {c.name}
                  </span>
                  {/* Count */}
                  <span
                    className="relative font-data text-sm font-black tabular-nums"
                    style={{ color }}
                  >
                    {c.count}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
