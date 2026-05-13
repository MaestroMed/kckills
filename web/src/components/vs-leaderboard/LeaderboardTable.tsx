"use client";

/**
 * /vs/leaderboard — rest-of-the-board (rows 4..N).
 *
 * Desktop : table layout with these columns :
 *   Rank · Kill thumbnail+matchup · ELO · Battles · Winrate · VS button
 *
 * Mobile  : same data but rendered as cards (1-col grid).
 *
 * The "VS" button currently jumps to /vs?seedA=<id>&seedB=<other>. Until
 * /vs supports a pair seed, we settle for /vs?focus=<id> as a soft hint
 * — the seed param is read-noop on /vs today but lays the wire for a
 * future "challenge this kill" feature. Clicking the thumbnail goes to
 * /scroll?kill=<id> so users can see the clip full-screen.
 *
 * Hover row : subtle gold glow + 1.01 scale. Reduced motion → snap.
 *
 * Pagination : the parent owns the page state. We expose `onLoadMore`
 * for an explicit button + `onReachEnd` for infinite scroll. The page
 * decides which to wire up — currently both work in parallel (a
 * sentinel div at the bottom intersects to trigger load, AND a "Voir +"
 * button below the grid lets keyboard users opt-out of infinite scroll).
 */

import { useEffect, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { m, useReducedMotion } from "motion/react";

import { championLoadingUrl } from "@/lib/constants";
import { winRatePct } from "@/lib/vs-roulette";
import type { EloLeaderboardRow } from "@/lib/supabase/vs-leaderboard";

interface LeaderboardTableProps {
  rows: EloLeaderboardRow[];
  /** Rank offset — first row is `startRank + 1` (typically 4 for the
   *  bottom of the leaderboard since the top 3 are in the podium). */
  startRank: number;
  loading?: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  onReachEnd?: () => void;
}

export function LeaderboardTable({
  rows,
  startRank,
  loading,
  hasMore,
  onLoadMore,
  onReachEnd,
}: LeaderboardTableProps) {
  const prefersReducedMotion = useReducedMotion();
  const sentinelRef = useRef<HTMLDivElement>(null);

  // ─── Infinite scroll sentinel ──────────────────────────────────────
  useEffect(() => {
    if (!onReachEnd || !hasMore || loading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onReachEnd();
          }
        }
      },
      { rootMargin: "240px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [onReachEnd, hasMore, loading]);

  if (rows.length === 0 && !loading) {
    return null; // Empty-state handled by parent
  }

  return (
    <section
      aria-label="Suite du classement ELO"
      className="mx-auto max-w-6xl px-3 md:px-6 mt-8 md:mt-12 pb-12"
    >
      {/* Mobile : card grid */}
      <ul className="md:hidden flex flex-col gap-2.5">
        {rows.map((row, i) => (
          <li key={row.kill_id}>
            <RowCard
              row={row}
              rank={startRank + i + 1}
              prefersReducedMotion={prefersReducedMotion ?? false}
              index={i}
            />
          </li>
        ))}
      </ul>

      {/* Desktop : table */}
      <div className="hidden md:block rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/65 backdrop-blur-md overflow-hidden">
        <table className="w-full" role="table">
          <thead>
            <tr className="border-b border-[var(--border-gold)]">
              <Th className="w-16 text-center">Rang</Th>
              <Th>Kill</Th>
              <Th className="w-24 text-right">ELO</Th>
              <Th className="w-20 text-right">Batailles</Th>
              <Th className="w-20 text-right">Winrate</Th>
              <Th className="w-32 text-right pr-5">Action</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <RowDesktop
                key={row.kill_id}
                row={row}
                rank={startRank + i + 1}
                prefersReducedMotion={prefersReducedMotion ?? false}
                index={i}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Infinite scroll sentinel */}
      {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}

      {/* Load more button (keyboard + screen-reader friendly fallback) */}
      {hasMore && (
        <div className="mt-6 flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            aria-label="Charger plus de kills dans le classement"
            className="rounded-xl border border-[var(--gold)]/40 bg-black/40 px-6 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--gold)] hover:border-[var(--gold)] hover:bg-[var(--gold)]/10 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {loading ? "Chargement…" : "Voir plus"}
          </button>
        </div>
      )}
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Desktop table row
// ════════════════════════════════════════════════════════════════════

function RowDesktop({
  row,
  rank,
  prefersReducedMotion,
  index,
}: {
  row: EloLeaderboardRow;
  rank: number;
  prefersReducedMotion: boolean;
  index: number;
}) {
  const killerName = row.killer_name ?? row.killer_champion ?? "?";
  const victimName = row.victim_name ?? row.victim_champion ?? "?";
  const wr = winRatePct(row.wins, row.battles_count);
  const thumb = row.thumbnail_url ?? (row.killer_champion ? championLoadingUrl(row.killer_champion) : null);

  return (
    <m.tr
      initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: prefersReducedMotion ? 0 : Math.min(index * 0.025, 0.4),
        ease: [0.16, 1, 0.3, 1],
      }}
      whileHover={prefersReducedMotion ? undefined : { scale: 1.005 }}
      className="border-b border-white/5 last:border-b-0 group transition-colors hover:bg-[var(--gold)]/[0.04]"
    >
      <td className="px-5 py-3 text-center">
        <RankChip rank={rank} />
      </td>
      <td className="py-3">
        <Link
          href={`/scroll?kill=${row.kill_id}`}
          className="flex items-center gap-3 group/inner"
          aria-label={`Lire le clip ${rank}: ${killerName} contre ${victimName}`}
        >
          <span
            className="relative flex-shrink-0 rounded-md overflow-hidden border border-white/10 group-hover/inner:border-[var(--gold)]/60 transition-colors"
            style={{
              width: 56,
              height: 100,
              boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
            }}
          >
            {thumb ? (
              <Image
                src={thumb}
                alt=""
                fill
                sizes="56px"
                className="object-cover transition-transform duration-500 group-hover/inner:scale-110"
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]">
                <span className="font-display text-xs text-[var(--gold-dark)]">KC</span>
              </div>
            )}
            {row.multi_kill && (
              <span
                aria-hidden
                className="absolute inset-x-0 bottom-0 px-1 py-0.5 font-data text-[8px] font-bold uppercase tracking-widest text-center bg-[var(--orange)]/85 text-black"
              >
                {row.multi_kill}
              </span>
            )}
          </span>
          <span className="min-w-0">
            <span className="block font-display text-sm font-bold text-white truncate group-hover/inner:text-[var(--gold-bright)] transition-colors">
              <span className="text-[var(--gold)]">{killerName}</span>
              <span className="text-white/55"> → </span>
              {victimName}
            </span>
            <span className="block font-data text-[10px] uppercase tracking-widest text-white/45 truncate">
              {row.killer_champion ?? "?"} vs {row.victim_champion ?? "?"}
              {row.killer_role ? ` · ${row.killer_role.toUpperCase()}` : ""}
              {row.is_first_blood ? " · FB" : ""}
            </span>
            {row.ai_description && (
              <span className="block mt-0.5 text-[11px] text-white/55 line-clamp-1">
                {row.ai_description}
              </span>
            )}
          </span>
        </Link>
      </td>
      <td className="px-3 py-3 text-right">
        <span className="font-data text-base font-black tabular-nums text-[var(--gold-bright)]">
          {Math.round(row.elo_rating)}
        </span>
      </td>
      <td className="px-3 py-3 text-right font-data text-sm tabular-nums text-white/80">
        {row.battles_count}
      </td>
      <td className="px-3 py-3 text-right">
        <WinrateChip wr={wr} />
      </td>
      <td className="px-3 py-3 pr-5 text-right">
        <Link
          href={`/vs?focus=${row.kill_id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--gold)]/45 bg-[var(--gold)]/10 px-3 py-1.5 font-display text-[10px] font-black uppercase tracking-[0.25em] text-[var(--gold)] hover:border-[var(--gold)] hover:bg-[var(--gold)]/20 transition-all"
          aria-label={`Affronter ${killerName} dans la roulette VS`}
        >
          VS <span aria-hidden>→</span>
        </Link>
      </td>
    </m.tr>
  );
}

// ════════════════════════════════════════════════════════════════════
// Mobile card row
// ════════════════════════════════════════════════════════════════════

function RowCard({
  row,
  rank,
  prefersReducedMotion,
  index,
}: {
  row: EloLeaderboardRow;
  rank: number;
  prefersReducedMotion: boolean;
  index: number;
}) {
  const killerName = row.killer_name ?? row.killer_champion ?? "?";
  const victimName = row.victim_name ?? row.victim_champion ?? "?";
  const wr = winRatePct(row.wins, row.battles_count);
  const thumb = row.thumbnail_url ?? (row.killer_champion ? championLoadingUrl(row.killer_champion) : null);

  return (
    <m.div
      initial={prefersReducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.35,
        delay: prefersReducedMotion ? 0 : Math.min(index * 0.03, 0.35),
      }}
      className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-md p-3"
      style={{ boxShadow: "0 8px 20px rgba(0,0,0,0.35)" }}
    >
      <div className="flex items-start gap-3">
        <Link
          href={`/scroll?kill=${row.kill_id}`}
          aria-label={`Lire le clip ${rank}: ${killerName} contre ${victimName}`}
          className="relative flex-shrink-0 rounded-md overflow-hidden border border-white/10"
          style={{
            width: 58,
            height: 104,
            boxShadow: "0 6px 14px rgba(0,0,0,0.4)",
          }}
        >
          {thumb ? (
            <Image
              src={thumb}
              alt=""
              fill
              sizes="58px"
              className="object-cover"
            />
          ) : (
            <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]">
              <span className="font-display text-xs text-[var(--gold-dark)]">KC</span>
            </div>
          )}
          {row.multi_kill && (
            <span
              aria-hidden
              className="absolute inset-x-0 bottom-0 px-1 py-0.5 font-data text-[8px] font-bold uppercase tracking-widest text-center bg-[var(--orange)]/85 text-black"
            >
              {row.multi_kill}
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <RankChip rank={rank} />
            <span className="font-data text-base font-black tabular-nums text-[var(--gold-bright)]">
              {Math.round(row.elo_rating)}
              <span className="ml-1 font-data text-[8px] font-bold uppercase tracking-widest text-[var(--gold)]/55">
                ELO
              </span>
            </span>
          </div>

          <p className="mt-1.5 font-display text-sm font-bold text-white leading-tight line-clamp-2">
            <span className="text-[var(--gold)]">{killerName}</span>
            <span className="text-white/55"> → </span>
            {victimName}
          </p>
          <p className="font-data text-[9px] uppercase tracking-widest text-white/45 truncate">
            {row.killer_champion ?? "?"} vs {row.victim_champion ?? "?"}
            {row.is_first_blood ? " · FB" : ""}
          </p>

          <div className="mt-2 flex items-center gap-3 flex-wrap">
            <Mini label="Battles" value={String(row.battles_count)} />
            <Mini label="WR" value={`${wr}%`} accent="var(--cyan)" />
            {row.highlight_score != null && (
              <Mini label="IA" value={row.highlight_score.toFixed(1)} accent="var(--gold)" />
            )}
            <Link
              href={`/vs?focus=${row.kill_id}`}
              className="ml-auto inline-flex items-center gap-1 rounded-md border border-[var(--gold)]/45 bg-[var(--gold)]/10 px-2 py-0.5 font-display text-[9px] font-black uppercase tracking-[0.25em] text-[var(--gold)]"
              aria-label={`Affronter ${killerName} dans la roulette VS`}
            >
              VS →
            </Link>
          </div>
        </div>
      </div>
    </m.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Atoms — RankChip, WinrateChip, Mini, Th
// ════════════════════════════════════════════════════════════════════

function RankChip({ rank }: { rank: number }) {
  return (
    <span
      className="inline-flex items-center justify-center rounded-md font-data text-[11px] font-black tabular-nums"
      style={{
        minWidth: 30,
        padding: "3px 7px",
        background: rank <= 10 ? "rgba(200,170,110,0.16)" : "rgba(255,255,255,0.05)",
        color: rank <= 10 ? "var(--gold-bright)" : "rgba(255,255,255,0.7)",
        border: rank <= 10 ? "1px solid rgba(200,170,110,0.4)" : "1px solid rgba(255,255,255,0.12)",
        boxShadow: rank <= 10 ? "0 0 12px rgba(200,170,110,0.15)" : "none",
      }}
    >
      #{rank}
    </span>
  );
}

function WinrateChip({ wr }: { wr: number }) {
  const color =
    wr >= 60
      ? "var(--green)"
      : wr >= 50
        ? "var(--gold-bright)"
        : wr >= 40
          ? "var(--orange)"
          : "var(--red)";
  return (
    <span
      className="inline-flex items-center justify-center rounded-md font-data text-xs font-black tabular-nums"
      style={{
        padding: "3px 8px",
        background: "rgba(0,0,0,0.4)",
        color,
        border: `1px solid ${color}55`,
      }}
    >
      {wr}%
    </span>
  );
}

function Mini({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-data text-[8px] uppercase tracking-[0.2em] text-white/45">
        {label}
      </span>
      <span
        className="font-data text-[11px] font-black tabular-nums"
        style={{ color: accent ?? "white" }}
      >
        {value}
      </span>
    </span>
  );
}

function Th({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <th
      className={`px-3 py-3 font-data text-[10px] font-bold uppercase tracking-[0.25em] text-[var(--gold)]/70 ${className ?? "text-left"}`}
    >
      {children}
    </th>
  );
}
