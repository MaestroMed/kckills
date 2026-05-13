"use client";

/**
 * /vs/leaderboard — root client component.
 *
 * Orchestrates the four sub-components :
 *   <Filters /> (sticky bar + mobile sheet)
 *   <Podium />  (top 3 cinematic)
 *   <LeaderboardTable /> (rows 4..N, infinite-scroll)
 *   <StatsSidebar /> + <StatsAccordion /> (sidebar / accordion stats)
 *
 * Data flow :
 *   - SSR seeds the first page (top 50 with default filters) and the
 *     sidebar stats via the parent server component. We display that
 *     instantly.
 *   - Whenever filters change OR the user hits "Voir plus" / scrolls to
 *     the sentinel, we fetch via the supabase browser client. The first
 *     50 rows of the default-filter view are the SSR seed ; subsequent
 *     calls all go through the client.
 *
 * Page size : 50 rows per fetch. The DB caps total at 200 rows so we
 * stop offering "Voir plus" past offset 200.
 *
 * Loading UX :
 *   - Empty-state skeletons for the podium + table.
 *   - On filter-change, we keep the old rows visible and apply a 60%
 *     opacity dim during the refetch — feels less jumpy than swap-to-
 *     skeleton on every filter tick.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { m, useReducedMotion } from "motion/react";

import { createClient } from "@/lib/supabase/client";
import { getVSSessionHash } from "@/lib/vs-roulette";
import type { Era } from "@/lib/eras";
import type {
  EloLeaderboardRow,
  EloLeaderboardStats,
} from "@/lib/supabase/vs-leaderboard";

import {
  Filters,
  DEFAULT_FILTERS,
  type LeaderboardFiltersValue,
} from "./Filters";
import { Podium } from "./Podium";
import { LeaderboardTable } from "./LeaderboardTable";
import { StatsSidebar, StatsAccordion } from "./StatsSidebar";

const PAGE_SIZE = 50;
const MAX_ROWS = 200;

interface VSLeaderboardProps {
  initialRows: EloLeaderboardRow[];
  initialStats: EloLeaderboardStats;
  champions: string[];
  eras: Era[];
}

interface RawLeaderboardRow {
  kill_id?: string | null;
  elo_rating?: number | null;
  battles_count?: number | null;
  wins?: number | null;
  killer_champion?: string | null;
  victim_champion?: string | null;
  killer_name?: string | null;
  killer_role?: string | null;
  victim_name?: string | null;
  clip_url_vertical?: string | null;
  clip_url_vertical_low?: string | null;
  thumbnail_url?: string | null;
  highlight_score?: number | null;
  avg_rating?: number | null;
  ai_description?: string | null;
  multi_kill?: string | null;
  is_first_blood?: boolean | null;
  created_at?: string | null;
  match_date?: string | null;
}

function normaliseRow(row: RawLeaderboardRow): EloLeaderboardRow | null {
  if (!row.kill_id) return null;
  return {
    kill_id: String(row.kill_id),
    elo_rating: typeof row.elo_rating === "number" ? row.elo_rating : 1500,
    battles_count: Number(row.battles_count ?? 0),
    wins: Number(row.wins ?? 0),
    killer_champion: row.killer_champion ?? null,
    victim_champion: row.victim_champion ?? null,
    killer_name: row.killer_name ?? null,
    killer_role: row.killer_role ?? null,
    victim_name: row.victim_name ?? null,
    clip_url_vertical: row.clip_url_vertical ?? null,
    clip_url_vertical_low: row.clip_url_vertical_low ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    highlight_score:
      typeof row.highlight_score === "number" ? row.highlight_score : null,
    avg_rating: typeof row.avg_rating === "number" ? row.avg_rating : null,
    ai_description: row.ai_description ?? null,
    multi_kill: row.multi_kill ?? null,
    is_first_blood: Boolean(row.is_first_blood),
    created_at: row.created_at ?? null,
    match_date: row.match_date ?? null,
  };
}

// ════════════════════════════════════════════════════════════════════
// Root component
// ════════════════════════════════════════════════════════════════════

export function VSLeaderboard({
  initialRows,
  initialStats,
  champions,
  eras,
}: VSLeaderboardProps) {
  const prefersReducedMotion = useReducedMotion();

  const [filters, setFilters] = useState<LeaderboardFiltersValue>(DEFAULT_FILTERS);
  const [rows, setRows] = useState<EloLeaderboardRow[]>(initialRows);
  const [loading, setLoading] = useState(false);
  const [appending, setAppending] = useState(false);
  const [offset, setOffset] = useState(initialRows.length);
  const [hasMore, setHasMore] = useState(
    initialRows.length === PAGE_SIZE && initialRows.length < MAX_ROWS,
  );
  const [sessionVoteCount, setSessionVoteCount] = useState(0);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  // Stable supabase client + session vote count on first client render.
  useEffect(() => {
    supabaseRef.current = createClient();
    const sb = supabaseRef.current;
    const hash = getVSSessionHash();
    if (!hash || hash.length < 16) return;
    let cancelled = false;
    (async () => {
      try {
        const { count, error } = await sb
          .from("vs_battles")
          .select("id", { count: "exact", head: true })
          .eq("voter_session_hash", hash);
        if (cancelled) return;
        if (error) {
          // Soft-fail : 0 is the correct "no votes yet" fallback.
          return;
        }
        setSessionVoteCount(count ?? 0);
      } catch {
        /* swallow — sidebar shows 0 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ─── Filter-triggered refetch (replace rows) ───────────────────────
  const isFirstFilterPass = useRef(true);
  useEffect(() => {
    // Skip the very first invocation : the SSR seed already matches
    // DEFAULT_FILTERS so a refetch would just shuffle bytes for nothing.
    if (isFirstFilterPass.current) {
      isFirstFilterPass.current = false;
      return;
    }
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const { data, error } = await sb.rpc("fn_top_elo_kills_v2", {
          p_limit: PAGE_SIZE,
          p_offset: 0,
          p_filter_role: filters.role,
          p_filter_champion: filters.champion,
          p_era_date_start: filters.eraDateStart,
          p_era_date_end: filters.eraDateEnd,
          p_min_battles: filters.minBattles,
        });
        if (cancelled) return;
        if (error) {
          setRows([]);
          setHasMore(false);
          setOffset(0);
          return;
        }
        const raws = (data ?? []) as RawLeaderboardRow[];
        const next: EloLeaderboardRow[] = [];
        for (const r of raws) {
          const n = normaliseRow(r);
          if (n) next.push(n);
        }
        setRows(next);
        setOffset(next.length);
        setHasMore(next.length === PAGE_SIZE && next.length < MAX_ROWS);
      } catch {
        if (!cancelled) {
          setRows([]);
          setHasMore(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [filters]);

  // ─── Load more (append) ────────────────────────────────────────────
  const loadMore = useCallback(async () => {
    if (appending || loading || !hasMore) return;
    if (offset >= MAX_ROWS) {
      setHasMore(false);
      return;
    }
    const sb = supabaseRef.current ?? createClient();
    supabaseRef.current = sb;
    setAppending(true);
    try {
      const limit = Math.min(PAGE_SIZE, MAX_ROWS - offset);
      const { data, error } = await sb.rpc("fn_top_elo_kills_v2", {
        p_limit: limit,
        p_offset: offset,
        p_filter_role: filters.role,
        p_filter_champion: filters.champion,
        p_era_date_start: filters.eraDateStart,
        p_era_date_end: filters.eraDateEnd,
        p_min_battles: filters.minBattles,
      });
      if (error) {
        setHasMore(false);
        return;
      }
      const raws = (data ?? []) as RawLeaderboardRow[];
      const next: EloLeaderboardRow[] = [];
      for (const r of raws) {
        const n = normaliseRow(r);
        if (n) next.push(n);
      }
      if (next.length === 0) {
        setHasMore(false);
        return;
      }
      // Dedup defensively against the existing list.
      setRows((prev) => {
        const seen = new Set(prev.map((p) => p.kill_id));
        const merged = [...prev];
        for (const r of next) {
          if (!seen.has(r.kill_id)) {
            merged.push(r);
            seen.add(r.kill_id);
          }
        }
        return merged;
      });
      setOffset(offset + next.length);
      setHasMore(next.length === limit && offset + next.length < MAX_ROWS);
    } catch {
      setHasMore(false);
    } finally {
      setAppending(false);
    }
  }, [appending, loading, hasMore, offset, filters]);

  const podium = rows.slice(0, 3);
  const restRows = rows.slice(3);
  const noResults = !loading && rows.length === 0;

  return (
    <div className="relative">
      {/* Sticky filters */}
      <Filters
        value={filters}
        onChange={setFilters}
        champions={champions}
        eras={eras}
        loading={loading}
        visibleCount={rows.length}
      />

      {/* Two-column layout : main + sidebar (desktop only) */}
      <div className="mx-auto max-w-7xl px-3 md:px-6 lg:grid lg:grid-cols-[1fr_320px] lg:gap-8">
        {/* Main column */}
        <div
          className="transition-opacity duration-300"
          style={{ opacity: loading ? 0.55 : 1 }}
          aria-busy={loading}
        >
          {/* Podium */}
          {podium.length > 0 ? (
            <Podium kills={podium} />
          ) : noResults ? (
            <EmptyState filters={filters} onReset={() => setFilters(DEFAULT_FILTERS)} />
          ) : loading ? (
            <PodiumSkeleton prefersReducedMotion={prefersReducedMotion ?? false} />
          ) : null}

          {/* Rest of leaderboard */}
          {restRows.length > 0 && (
            <LeaderboardTable
              rows={restRows}
              startRank={3}
              loading={appending}
              hasMore={hasMore}
              onLoadMore={loadMore}
              onReachEnd={loadMore}
            />
          )}
        </div>

        {/* Desktop sidebar */}
        <StatsSidebar stats={initialStats} sessionVoteCount={sessionVoteCount} />
      </div>

      {/* Mobile accordion (below main column on small screens) */}
      <StatsAccordion stats={initialStats} sessionVoteCount={sessionVoteCount} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Empty state
// ════════════════════════════════════════════════════════════════════

function EmptyState({
  filters,
  onReset,
}: {
  filters: LeaderboardFiltersValue;
  onReset: () => void;
}) {
  const hasFilters =
    filters.role !== null ||
    filters.champion !== null ||
    filters.eraId !== null ||
    filters.minBattles > 5;
  return (
    <section className="mx-auto max-w-2xl px-3 py-16 text-center">
      <div className="inline-flex items-center justify-center mb-5">
        <span
          aria-hidden
          className="inline-block"
          style={{
            width: 18,
            height: 18,
            transform: "rotate(45deg)",
            background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
            boxShadow: "0 0 20px rgba(200,170,110,0.5)",
          }}
        />
      </div>
      <h2 className="font-display text-2xl md:text-3xl font-black text-[var(--gold-bright)]">
        Pas assez de batailles
      </h2>
      <p className="mt-3 max-w-md mx-auto text-sm text-white/70">
        {hasFilters
          ? "Aucun kill ne passe ce filtre avec ce minimum de batailles. Relâche un filtre ou descends le seuil."
          : "Le ELO se débloque dès qu'un kill a accumulé 5 batailles. Va voter sur la roulette pour faire bouger le classement !"}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {hasFilters && (
          <button
            type="button"
            onClick={onReset}
            className="rounded-xl border border-white/20 bg-black/30 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-white/80 hover:border-white/45 hover:text-white transition-all"
            aria-label="Réinitialiser les filtres"
          >
            Reset filtres
          </button>
        )}
        <Link
          href="/vs"
          className="rounded-xl bg-[var(--gold)] px-5 py-2.5 font-display text-xs font-black uppercase tracking-[0.25em] text-[var(--bg-primary)] hover:bg-[var(--gold-bright)] transition-all"
          style={{
            boxShadow: "0 12px 26px rgba(200,170,110,0.32), inset 0 1px 0 rgba(255,255,255,0.4)",
          }}
        >
          Lancer la roulette
        </Link>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Podium skeleton (refetch in flight, no results yet)
// ════════════════════════════════════════════════════════════════════

function PodiumSkeleton({
  prefersReducedMotion,
}: {
  prefersReducedMotion: boolean;
}) {
  return (
    <section className="mx-auto max-w-5xl px-4 pt-8 md:pt-12">
      <div className="grid gap-5 md:grid-cols-3 md:gap-8 items-end">
        {[1, 0, 2].map((rank) => (
          <m.div
            key={rank}
            animate={
              prefersReducedMotion
                ? undefined
                : { opacity: [0.4, 0.75, 0.4] }
            }
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
            className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/40"
            style={{ aspectRatio: "9 / 16", transform: `scale(${rank === 0 ? 1.08 : 0.94})` }}
          />
        ))}
      </div>
    </section>
  );
}
