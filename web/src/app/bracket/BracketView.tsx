"use client";

/**
 * BracketView — client interactive bracket tree for /bracket.
 *
 * Renders the full single-elimination tree :
 *   - 6 (or 5/4/3) rounds laid out horizontally on desktop, vertically
 *     on mobile (with horizontal scroll within each round strip).
 *   - Each match card shows both kill thumbnails + current vote counts.
 *     If the match is currently open, a "VOTER" button reveals a modal
 *     with both clips playing side-by-side.
 *   - Past rounds : the winner is highlighted with a gold crown.
 *   - Final : the champion gets a "GOAT DU MOIS" gold badge.
 *
 * Vote flow :
 *   1. Click VOTER on an open match → modal opens, clips autoplay
 *   2. Click "Celui-ci" on either side → fn_record_bracket_vote
 *   3. Tallies animate, modal stays open showing "Reviens demain"
 *
 * The session hash pattern mirrors VS / face-off : `kckills_bracket_session_id`
 * stashed in localStorage, generated with crypto.getRandomValues.
 *
 * Accessibility :
 *   - aria-label on every interactive control
 *   - prefers-reduced-motion → no entry animation, no tally tick, no glow
 *   - modal traps focus, ESC closes
 *   - keyboard nav : Tab cycles matches in each round
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { m, AnimatePresence, useReducedMotion } from "motion/react";

import { createClient } from "@/lib/supabase/client";
import type {
  BracketBundle,
  BracketMatch,
  BracketTournament,
  PastWinner,
} from "@/lib/supabase/bracket";
import {
  currentRound,
  nextCloseAt,
  openMatchCount,
  roundLabel,
  roundsForSize,
} from "@/lib/supabase/bracket";

// ════════════════════════════════════════════════════════════════════
// Session hash — mirrors vs / face-off / bcc patterns
// ════════════════════════════════════════════════════════════════════

const BRACKET_SESSION_KEY = "kckills_bracket_session_id";

function getBracketSessionHash(): string {
  if (typeof window === "undefined") return "bracket-ssr-placeholder-hash";
  try {
    const existing = window.localStorage.getItem(BRACKET_SESSION_KEY);
    if (existing && existing.length >= 16) return existing;
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    }
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    const fresh = `bracket-${hex}`;
    window.localStorage.setItem(BRACKET_SESSION_KEY, fresh);
    return fresh;
  } catch {
    return `bracket-${Math.random().toString(16).slice(2).padStart(16, "0")}`;
  }
}

const VOTED_MATCHES_KEY = "kckills_bracket_voted_matches";

function readVotedMatches(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(VOTED_MATCHES_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((s) => typeof s === "string"));
  } catch {
    return new Set();
  }
}

function persistVotedMatches(set: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(VOTED_MATCHES_KEY, JSON.stringify([...set]));
  } catch {
    // ignore — private mode
  }
}

// ════════════════════════════════════════════════════════════════════
// Public props
// ════════════════════════════════════════════════════════════════════

export interface BracketViewProps {
  bundle: BracketBundle;
  pastWinners: PastWinner[];
  /** When true, the bracket is read-only (no VOTER buttons, no modal CTAs). */
  readOnly?: boolean;
}

export function BracketView({ bundle, pastWinners, readOnly = false }: BracketViewProps) {
  const prefersReducedMotion = useReducedMotion() ?? false;
  const { tournament, matches } = bundle;

  // Hydrate the locally-persisted voted-matches set + bump every minute so
  // the hero ticker stays fresh without resorting to a server poll.
  const [voted, setVoted] = useState<Set<string>>(() => new Set());
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setVoted(readVotedMatches());
    const interval = window.setInterval(() => setTick((t) => t + 1), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Local mutable tally state (optimistic + RPC-confirmed updates).
  const [localTallies, setLocalTallies] = useState<Map<string, { votes_a: number; votes_b: number }>>(
    () => new Map(),
  );

  // Modal target match id (null = closed).
  const [openMatchId, setOpenMatchId] = useState<string | null>(null);

  // Group matches by round once for cheap renders downstream.
  const byRound = useMemo(() => groupByRound(matches), [matches]);
  const rounds = useMemo(() => {
    if (!tournament) return [];
    const total = roundsForSize(tournament.bracket_size);
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [tournament]);

  // Current round (lowest round with open matches), counts.
  const nowMs = Date.now() + tick * 0; // tick forces re-eval each minute
  const activeRound = useMemo(() => currentRound(matches), [matches]);
  const openCount = useMemo(() => openMatchCount(matches, nowMs), [matches, nowMs]);
  const nextClose = useMemo(() => nextCloseAt(matches, nowMs), [matches, nowMs]);

  // Champion (if final has been decided).
  const champion = useMemo(() => {
    if (!tournament) return null;
    if (!tournament.champion_kill_id) return null;
    return matches.find(
      (m) => m.round === rounds.length && m.winner_kill_id === tournament.champion_kill_id,
    );
  }, [tournament, matches, rounds.length]);

  // Apply local tally overlays atop the server snapshot.
  const matchesWithLocalTallies = useMemo<BracketMatch[]>(
    () =>
      matches.map((m) => {
        const local = localTallies.get(m.id);
        if (!local) return m;
        return { ...m, votes_a: local.votes_a, votes_b: local.votes_b };
      }),
    [matches, localTallies],
  );

  const openMatch = openMatchId
    ? matchesWithLocalTallies.find((m) => m.id === openMatchId) ?? null
    : null;

  const markVoted = useCallback((matchId: string, tally: { votes_a: number; votes_b: number }) => {
    setLocalTallies((prev) => {
      const next = new Map(prev);
      next.set(matchId, tally);
      return next;
    });
    setVoted((prev) => {
      const next = new Set(prev);
      next.add(matchId);
      persistVotedMatches(next);
      return next;
    });
  }, []);

  if (!tournament) {
    return <EmptyState />;
  }

  return (
    <>
      <HeroBand
        tournament={tournament}
        activeRound={activeRound}
        totalRounds={rounds.length}
        openCount={openCount}
        nextClose={nextClose}
        champion={champion ?? null}
        readOnly={readOnly}
      />

      <BracketTree
        rounds={rounds}
        byRound={byRound}
        matches={matchesWithLocalTallies}
        tournament={tournament}
        activeRound={activeRound}
        voted={voted}
        readOnly={readOnly}
        onOpenMatch={(id) => setOpenMatchId(id)}
        prefersReducedMotion={prefersReducedMotion}
      />

      <PastWinnersGallery winners={pastWinners} currentSlug={tournament.slug} />

      <AnimatePresence>
        {openMatch && tournament && (
          <VoteModal
            key={openMatch.id}
            tournament={tournament}
            match={openMatch}
            alreadyVoted={voted.has(openMatch.id)}
            readOnly={readOnly}
            onClose={() => setOpenMatchId(null)}
            onVoted={(tally) => markVoted(openMatch.id, tally)}
            prefersReducedMotion={prefersReducedMotion}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function groupByRound(matches: BracketMatch[]): Map<number, BracketMatch[]> {
  const out = new Map<number, BracketMatch[]>();
  for (const m of matches) {
    const list = out.get(m.round) ?? [];
    list.push(m);
    out.set(m.round, list);
  }
  // Sort each round by match_index for stable layout.
  for (const list of out.values()) {
    list.sort((a, b) => a.match_index - b.match_index);
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════
// Empty state — no tournament seeded yet
// ════════════════════════════════════════════════════════════════════

function EmptyState() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16 md:py-24 text-center">
      <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-4">
        Aucun tournoi en cours
      </p>
      <h2 className="font-display text-3xl md:text-5xl font-black text-[var(--text-primary)] leading-tight mb-3">
        Le prochain tournoi arrive
      </h2>
      <p className="mx-auto max-w-xl text-sm md:text-base text-white/65">
        Le bracket mensuel se relance le premier de chaque mois. En attendant,
        continue de scroller — tes votes nourrissent le seeding du prochain GOAT du Mois.
      </p>
      <div className="mt-7 flex justify-center gap-3 flex-wrap">
        <Link
          href="/scroll"
          className="rounded-xl bg-[var(--gold)] px-6 py-3 font-display text-xs font-black uppercase tracking-[0.25em] text-[var(--bg-primary)] hover:bg-[var(--gold-bright)] transition-colors"
        >
          Aller au feed
        </Link>
        <Link
          href="/vs"
          className="rounded-xl border border-[var(--gold)]/45 bg-black/30 px-6 py-3 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--gold)] hover:bg-[var(--gold)]/10 transition-colors"
        >
          VS Roulette
        </Link>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Hero band
// ════════════════════════════════════════════════════════════════════

function HeroBand({
  tournament,
  activeRound,
  totalRounds,
  openCount,
  nextClose,
  champion,
  readOnly,
}: {
  tournament: BracketTournament;
  activeRound: number | null;
  totalRounds: number;
  openCount: number;
  nextClose: string | null;
  champion: BracketMatch | null;
  readOnly: boolean;
}) {
  const isClosed = tournament.status !== "open";
  const dateRange = formatDateRange(tournament.start_date, tournament.end_date);
  const headline = tournament.name.toUpperCase();

  return (
    <section
      className="relative overflow-hidden border-b border-[var(--border-gold)]"
      style={{
        background:
          "radial-gradient(ellipse 70% 55% at 50% 30%, rgba(200,170,110,0.18) 0%, transparent 60%), linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-primary) 100%)",
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.14] mix-blend-overlay pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
        }}
      />
      <div
        aria-hidden
        className="absolute left-[5%] top-10 hidden md:block"
        style={{
          width: 14,
          height: 14,
          transform: "rotate(45deg)",
          background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
          opacity: 0.55,
          boxShadow: "0 0 22px rgba(200,170,110,0.5)",
        }}
      />
      <div
        aria-hidden
        className="absolute right-[7%] top-24 hidden md:block"
        style={{
          width: 9,
          height: 9,
          transform: "rotate(45deg)",
          background: "var(--cyan)",
          opacity: 0.45,
          boxShadow: "0 0 14px rgba(10,200,185,0.5)",
        }}
      />

      <div className="relative z-10 mx-auto max-w-6xl px-5 pt-10 pb-8 md:pt-16 md:pb-12 text-center">
        <p className="font-data text-[11px] uppercase tracking-[0.4em] text-[var(--gold)]/70 mb-3">
          GOAT du Mois · {tournament.bracket_size} kills · {totalRounds} rounds
        </p>
        <h1
          className="font-display font-black tracking-tight leading-[0.85] text-4xl md:text-6xl lg:text-7xl"
          style={{
            color: "white",
            textShadow:
              "0 0 60px rgba(200,170,110,0.45), 0 6px 30px rgba(0,0,0,0.85)",
            letterSpacing: "-0.015em",
          }}
        >
          {headline}
        </h1>
        <p className="mt-4 mx-auto max-w-2xl text-sm md:text-base text-white/75 font-medium">
          {dateRange}
        </p>

        <div className="mt-6 flex items-center justify-center gap-3 flex-wrap text-[11px] font-data uppercase tracking-[0.25em]">
          {isClosed ? (
            <span className="rounded-full border border-[var(--gold)]/45 bg-black/30 px-4 py-2 text-[var(--gold)]">
              Tournoi clôturé
            </span>
          ) : activeRound != null ? (
            <>
              <span className="rounded-full border border-[var(--cyan)]/45 bg-[var(--cyan)]/8 px-4 py-2 text-[var(--cyan)]">
                Round actuel · {roundLabel(activeRound, totalRounds)}
              </span>
              <span className="rounded-full border border-[var(--gold)]/45 bg-black/30 px-4 py-2 text-[var(--gold)]/85">
                {openCount} match{openCount > 1 ? "s" : ""} ouvert{openCount > 1 ? "s" : ""}
              </span>
              {nextClose && (
                <span className="rounded-full border border-white/15 bg-black/25 px-4 py-2 text-white/65">
                  Clôture {formatRelative(nextClose)}
                </span>
              )}
            </>
          ) : (
            <span className="rounded-full border border-[var(--gold)]/45 bg-black/30 px-4 py-2 text-[var(--gold)]">
              Aucun match ouvert
            </span>
          )}
        </div>

        {champion && (
          <ChampionBanner champion={champion} readOnly={readOnly} />
        )}
      </div>
    </section>
  );
}

function ChampionBanner({ champion, readOnly }: { champion: BracketMatch; readOnly: boolean }) {
  const championKillId = champion.winner_kill_id;
  if (!championKillId) return null;
  const isASide = champion.kill_a_id === championKillId;
  const name = isASide ? champion.kill_a_killer_name : champion.kill_b_killer_name;
  const champ = isASide ? champion.kill_a_killer_champion : champion.kill_b_killer_champion;
  const thumb = isASide ? champion.kill_a_thumbnail : champion.kill_b_thumbnail;
  return (
    <div
      className="mt-7 mx-auto max-w-2xl rounded-2xl border bg-[var(--bg-surface)]/80 backdrop-blur-md overflow-hidden"
      style={{
        borderColor: "var(--gold-bright)",
        boxShadow:
          "0 24px 60px rgba(0,0,0,0.55), 0 0 80px rgba(240,230,210,0.35), inset 0 0 0 1px rgba(240,230,210,0.25)",
      }}
    >
      <div className="grid grid-cols-[100px_1fr] gap-3 items-stretch">
        <div className="relative bg-black/40" style={{ aspectRatio: "9 / 16" }}>
          {thumb ? (
            <Image
              src={thumb}
              alt={`Vainqueur ${name ?? champ ?? "?"}`}
              fill
              sizes="100px"
              className="object-cover"
            />
          ) : null}
        </div>
        <div className="py-3 pr-4 text-left flex flex-col justify-center">
          <span
            className="inline-block rounded-md self-start px-2 py-0.5 mb-2 text-[9px] font-data font-black uppercase tracking-[0.25em]"
            style={{
              color: "var(--bg-primary)",
              background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
              boxShadow: "0 0 14px rgba(240,230,210,0.5)",
            }}
          >
            ♛ GOAT du Mois
          </span>
          <p className="font-display text-xl md:text-2xl font-black text-[var(--text-primary)] leading-tight">
            <span style={{ color: "var(--gold)" }}>{name ?? champ ?? "?"}</span>{" "}
            <span className="text-white/70">{champ}</span>
          </p>
          {!readOnly && championKillId && (
            <Link
              href={`/kill/${championKillId}`}
              className="mt-2 inline-block font-data text-[10px] uppercase tracking-widest text-[var(--gold)]/85 hover:text-[var(--gold)] transition-colors"
            >
              Voir le clip champion →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Bracket tree — rounds laid out horizontally
// ════════════════════════════════════════════════════════════════════

function BracketTree({
  rounds,
  byRound,
  matches,
  tournament,
  activeRound,
  voted,
  readOnly,
  onOpenMatch,
  prefersReducedMotion,
}: {
  rounds: number[];
  byRound: Map<number, BracketMatch[]>;
  matches: BracketMatch[];
  tournament: BracketTournament;
  activeRound: number | null;
  voted: Set<string>;
  readOnly: boolean;
  onOpenMatch: (matchId: string) => void;
  prefersReducedMotion: boolean;
}) {
  void matches;
  void tournament;
  return (
    <section
      aria-label="Arbre du tournoi"
      className="relative mx-auto max-w-[100vw] px-3 md:px-6 py-8 md:py-12 overflow-x-auto"
    >
      <div
        className="flex gap-3 md:gap-6 items-start min-w-max mx-auto"
        style={{ paddingBottom: 6 }}
      >
        {rounds.map((r) => {
          const list = byRound.get(r) ?? [];
          const isActive = activeRound === r;
          const isClosed = list.every((m) => m.winner_kill_id != null) && list.length > 0;
          const isPending =
            activeRound != null && r > activeRound;
          return (
            <RoundColumn
              key={r}
              round={r}
              totalRounds={rounds.length}
              matches={list}
              isActive={isActive}
              isClosed={isClosed}
              isPending={isPending}
              voted={voted}
              readOnly={readOnly}
              onOpenMatch={onOpenMatch}
              prefersReducedMotion={prefersReducedMotion}
            />
          );
        })}
      </div>
      <p className="mt-4 text-center font-data text-[10px] uppercase tracking-widest text-white/35 md:hidden">
        Glisse horizontalement pour voir tous les rounds →
      </p>
    </section>
  );
}

function RoundColumn({
  round,
  totalRounds,
  matches,
  isActive,
  isClosed,
  isPending,
  voted,
  readOnly,
  onOpenMatch,
  prefersReducedMotion,
}: {
  round: number;
  totalRounds: number;
  matches: BracketMatch[];
  isActive: boolean;
  isClosed: boolean;
  isPending: boolean;
  voted: Set<string>;
  readOnly: boolean;
  onOpenMatch: (matchId: string) => void;
  prefersReducedMotion: boolean;
}) {
  // Progressive narrowing : R1 cards are smaller, the final is huge.
  const fromFinal = totalRounds - round;
  // base width 200 on mobile, 260 on desktop, scaled by fromFinal
  // (final = +24px, semi = +12px, others stock).
  const baseCardWidth = 200;
  const desktopCardWidth = 260;
  const widthBonus = fromFinal === 0 ? 40 : fromFinal === 1 ? 20 : 0;

  return (
    <div className="flex flex-col items-stretch">
      <header className="mb-3 px-1">
        <div className="flex items-center gap-2">
          <span
            className="inline-block"
            aria-hidden
            style={{
              width: 8,
              height: 8,
              transform: "rotate(45deg)",
              background: isClosed
                ? "linear-gradient(135deg, var(--gold-bright), var(--gold))"
                : isActive
                  ? "var(--cyan)"
                  : "rgba(200,170,110,0.4)",
              boxShadow: isActive ? "0 0 12px rgba(10,200,185,0.6)" : undefined,
            }}
          />
          <p
            className="font-display text-[10px] md:text-xs font-black uppercase tracking-[0.25em] whitespace-nowrap"
            style={{ color: isClosed ? "var(--gold)" : isActive ? "var(--cyan)" : "var(--text-muted)" }}
          >
            {roundLabel(round, totalRounds)}
          </p>
        </div>
      </header>
      <div className="flex flex-col gap-3 md:gap-4">
        {matches.map((m) => (
          <MatchCard
            key={m.id}
            match={m}
            totalRounds={totalRounds}
            isPending={isPending}
            isActive={isActive}
            voted={voted.has(m.id)}
            readOnly={readOnly}
            onOpen={() => onOpenMatch(m.id)}
            baseWidth={baseCardWidth}
            desktopWidth={desktopCardWidth + widthBonus}
            prefersReducedMotion={prefersReducedMotion}
          />
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Match card — the building block of each round column
// ════════════════════════════════════════════════════════════════════

function MatchCard({
  match,
  totalRounds,
  isPending,
  isActive,
  voted,
  readOnly,
  onOpen,
  baseWidth,
  desktopWidth,
  prefersReducedMotion,
}: {
  match: BracketMatch;
  totalRounds: number;
  isPending: boolean;
  isActive: boolean;
  voted: boolean;
  readOnly: boolean;
  onOpen: () => void;
  baseWidth: number;
  desktopWidth: number;
  prefersReducedMotion: boolean;
}) {
  const nowMs = Date.now();
  const opensAt = new Date(match.opens_at).getTime();
  const closesAt = new Date(match.closes_at).getTime();
  const isOpen =
    match.winner_kill_id == null &&
    match.kill_a_id != null &&
    match.kill_b_id != null &&
    Number.isFinite(opensAt) &&
    Number.isFinite(closesAt) &&
    nowMs >= opensAt &&
    nowMs <= closesAt;
  const isResolved = match.winner_kill_id != null;
  const isFinal = match.round === totalRounds;

  const winnerSide: "a" | "b" | null =
    match.winner_kill_id == null
      ? null
      : match.winner_kill_id === match.kill_a_id
        ? "a"
        : match.winner_kill_id === match.kill_b_id
          ? "b"
          : null;

  // Two width vars : mobile-first base, desktop bump via media query.
  // Using CSS custom props keeps the SSR / client render byte-identical.
  return (
    <div
      className="bracket-card relative rounded-xl border bg-[var(--bg-surface)]/70 backdrop-blur-md transition-all"
      style={{
        // The card width swaps via inline CSS below — base on mobile,
        // `--desktop-card-width` once the @media kicks in.
        ["--mobile-card-width" as string]: `${baseWidth}px`,
        ["--desktop-card-width" as string]: `${desktopWidth}px`,
        maxWidth: "calc(100vw - 32px)",
        borderColor: isFinal
          ? "var(--gold-bright)"
          : isActive
            ? "rgba(10,200,185,0.55)"
            : isResolved
              ? "rgba(200,170,110,0.35)"
              : isPending
                ? "rgba(120,90,40,0.3)"
                : "rgba(200,170,110,0.18)",
        boxShadow: isFinal
          ? "0 24px 50px rgba(0,0,0,0.55), 0 0 50px rgba(240,230,210,0.35), inset 0 0 0 1px rgba(240,230,210,0.2)"
          : isActive
            ? "0 18px 38px rgba(0,0,0,0.45), 0 0 40px rgba(10,200,185,0.25)"
            : "0 12px 28px rgba(0,0,0,0.4)",
        opacity: isPending ? 0.55 : 1,
        width: "var(--mobile-card-width)",
      }}
    >
      {/* Match index micro-label */}
      <div className="flex items-center justify-between px-3 pt-2 pb-1.5">
        <span className="font-data text-[9px] uppercase tracking-[0.25em] text-white/40">
          Match #{match.match_index + 1}
        </span>
        {voted && (
          <span
            className="font-data text-[9px] uppercase tracking-[0.25em]"
            style={{ color: "var(--gold)" }}
          >
            ✓ Voté
          </span>
        )}
      </div>

      <SideRow
        side="a"
        thumb={match.kill_a_thumbnail}
        name={match.kill_a_killer_name}
        champion={match.kill_a_killer_champion}
        victim={match.kill_a_victim_champion}
        votes={match.votes_a}
        multiKill={match.kill_a_multi_kill}
        firstBlood={match.kill_a_first_blood}
        isWinner={winnerSide === "a"}
        dimmed={isResolved && winnerSide !== "a"}
        empty={match.kill_a_id == null}
        prefersReducedMotion={prefersReducedMotion}
      />

      <div className="flex items-center justify-center py-1">
        <span
          aria-hidden
          className="text-[10px] font-data font-black uppercase tracking-[0.3em]"
          style={{ color: isFinal ? "var(--gold-bright)" : "var(--text-muted)" }}
        >
          VS
        </span>
      </div>

      <SideRow
        side="b"
        thumb={match.kill_b_thumbnail}
        name={match.kill_b_killer_name}
        champion={match.kill_b_killer_champion}
        victim={match.kill_b_victim_champion}
        votes={match.votes_b}
        multiKill={match.kill_b_multi_kill}
        firstBlood={match.kill_b_first_blood}
        isWinner={winnerSide === "b"}
        dimmed={isResolved && winnerSide !== "b"}
        empty={match.kill_b_id == null}
        prefersReducedMotion={prefersReducedMotion}
      />

      <div className="px-3 pt-2 pb-3">
        {isOpen && !readOnly ? (
          <button
            type="button"
            onClick={onOpen}
            aria-label={`Voter pour le match ${match.match_index + 1}`}
            className="w-full rounded-lg bg-[var(--gold)] hover:bg-[var(--gold-bright)] active:scale-[0.98] transition-all py-2 font-display text-[11px] font-black uppercase tracking-[0.3em] text-[var(--bg-primary)]"
            style={{
              boxShadow:
                "0 12px 26px rgba(200,170,110,0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
            }}
          >
            {voted ? "Revoir" : "Voter"}
          </button>
        ) : isResolved ? (
          <div className="text-center font-data text-[9px] uppercase tracking-widest text-white/40">
            {isFinal ? "Champion couronné" : "Round clôturé"}
          </div>
        ) : isPending ? (
          <div className="text-center font-data text-[9px] uppercase tracking-widest text-white/35">
            En attente
          </div>
        ) : !readOnly && match.kill_a_id != null && match.kill_b_id != null ? (
          <div className="text-center font-data text-[9px] uppercase tracking-widest text-white/35">
            Ouvre {formatRelative(match.opens_at)}
          </div>
        ) : (
          <div className="text-center font-data text-[9px] uppercase tracking-widest text-white/30">
            —
          </div>
        )}
      </div>
      <style jsx>{`
        @media (min-width: 768px) {
          .bracket-card {
            width: var(--desktop-card-width) !important;
          }
        }
      `}</style>
    </div>
  );
}

function SideRow({
  side,
  thumb,
  name,
  champion,
  victim,
  votes,
  multiKill,
  firstBlood,
  isWinner,
  dimmed,
  empty,
  prefersReducedMotion,
}: {
  side: "a" | "b";
  thumb: string | null;
  name: string | null;
  champion: string | null;
  victim: string | null;
  votes: number;
  multiKill: string | null;
  firstBlood: boolean;
  isWinner: boolean;
  dimmed: boolean;
  empty: boolean;
  prefersReducedMotion: boolean;
}) {
  void side;
  if (empty) {
    return (
      <div className="px-3 py-2 flex items-center gap-2 opacity-50">
        <div
          className="rounded-md bg-black/40 border border-white/10"
          style={{ width: 36, aspectRatio: "9 / 16" }}
        />
        <div className="flex-1 min-w-0">
          <p className="font-data text-[10px] uppercase tracking-widest text-white/35">
            À déterminer
          </p>
        </div>
      </div>
    );
  }
  return (
    <m.div
      animate={
        prefersReducedMotion ? undefined : { opacity: dimmed ? 0.45 : 1, scale: isWinner ? 1.0 : 1.0 }
      }
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="px-3 py-2 flex items-center gap-2"
    >
      <div
        className="relative rounded-md overflow-hidden flex-shrink-0 bg-black/40 border"
        style={{
          width: 36,
          aspectRatio: "9 / 16",
          borderColor: isWinner ? "var(--gold-bright)" : "rgba(255,255,255,0.12)",
          boxShadow: isWinner ? "0 0 14px rgba(240,230,210,0.4)" : undefined,
        }}
      >
        {thumb ? (
          <Image src={thumb} alt="" fill sizes="36px" className="object-cover" />
        ) : null}
        {isWinner && (
          <span
            aria-hidden
            className="absolute top-0 right-0 text-[10px]"
            style={{ color: "var(--gold-bright)", textShadow: "0 0 8px rgba(240,230,210,0.7)" }}
          >
            ♛
          </span>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="font-display text-xs font-bold truncate leading-tight"
          style={{ color: isWinner ? "var(--gold-bright)" : "var(--text-primary)" }}
        >
          {name ?? champion ?? "?"}
        </p>
        <p className="font-data text-[9px] uppercase tracking-widest text-white/45 truncate">
          {champion ?? "?"}
          {victim ? <> · vs {victim}</> : null}
        </p>
        <div className="flex items-center gap-1 mt-0.5">
          {multiKill && (
            <span className="rounded px-1 text-[8px] font-data font-bold uppercase tracking-widest text-[var(--orange)] border border-[var(--orange)]/30">
              {multiKill}
            </span>
          )}
          {firstBlood && (
            <span className="rounded px-1 text-[8px] font-data font-bold uppercase tracking-widest text-[var(--red)] border border-[var(--red)]/30">
              FB
            </span>
          )}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <p
          className="font-display text-sm font-black"
          style={{ color: isWinner ? "var(--gold-bright)" : "var(--text-primary)" }}
        >
          {votes}
        </p>
        <p className="font-data text-[8px] uppercase tracking-widest text-white/35">
          vote{votes > 1 ? "s" : ""}
        </p>
      </div>
    </m.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Vote modal — opens when user clicks VOTER on an active match
// ════════════════════════════════════════════════════════════════════

function VoteModal({
  tournament,
  match,
  alreadyVoted,
  readOnly,
  onClose,
  onVoted,
  prefersReducedMotion,
}: {
  tournament: BracketTournament;
  match: BracketMatch;
  alreadyVoted: boolean;
  readOnly: boolean;
  onClose: () => void;
  onVoted: (tally: { votes_a: number; votes_b: number }) => void;
  prefersReducedMotion: boolean;
}) {
  void tournament;
  const [voting, setVoting] = useState(false);
  // `voted` tracks WHICH side the user voted for in THIS modal session.
  // `alreadyVoted` (prop) indicates a vote was cast in a PRIOR session —
  // we honor it by treating `alreadyVotedOnce` as true for both buttons.
  const [voted, setVoted] = useState<"a" | "b" | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const sessionHashRef = useRef<string>("bracket-ssr-placeholder");
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    sessionHashRef.current = getBracketSessionHash();
  }, []);

  // Focus close button on mount + trap focus minimally.
  useEffect(() => {
    closeButtonRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const castVote = useCallback(
    async (choice: "a" | "b") => {
      if (voting || readOnly) return;
      const winnerKillId = choice === "a" ? match.kill_a_id : match.kill_b_id;
      if (!winnerKillId) return;
      setVoting(true);
      setVoteError(null);
      const sb = createClient();
      try {
        const { data, error } = await sb.rpc("fn_record_bracket_vote", {
          p_match_id: match.id,
          p_winner_kill_id: winnerKillId,
          p_session_hash: sessionHashRef.current,
        });
        if (error) {
          setVoteError(error.message);
        } else {
          const rows = Array.isArray(data) ? data : [];
          const row = rows[0] as { votes_a?: number; votes_b?: number } | undefined;
          if (row) {
            onVoted({ votes_a: Number(row.votes_a ?? 0), votes_b: Number(row.votes_b ?? 0) });
          }
          setVoted(choice);
        }
      } catch (err) {
        setVoteError(err instanceof Error ? err.message : "Erreur réseau");
      } finally {
        setVoting(false);
      }
    },
    [voting, readOnly, match.id, match.kill_a_id, match.kill_b_id, onVoted],
  );

  const disabledA = match.kill_a_id == null;
  const disabledB = match.kill_b_id == null;

  return (
    <m.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="bracket-modal-title"
      initial={prefersReducedMotion ? undefined : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-end md:items-center justify-center p-3 md:p-8 bg-black/85 backdrop-blur-md"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <m.div
        initial={prefersReducedMotion ? undefined : { y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={prefersReducedMotion ? undefined : { y: 30, opacity: 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-4xl rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/95 backdrop-blur-md overflow-hidden"
        style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.7), inset 0 0 0 1px rgba(200,170,110,0.08)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <p id="bracket-modal-title" className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/80">
              Match #{match.match_index + 1}
            </p>
            <p className="font-display text-base md:text-lg font-black text-[var(--text-primary)] leading-tight">
              {voted || alreadyVoted
                ? "Tu as voté — Reviens demain pour la suite"
                : "Quel kill est le plus fort ?"}
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Fermer"
            className="rounded-lg border border-white/15 bg-black/30 px-3 py-1.5 font-data text-xs uppercase tracking-widest text-white/65 hover:border-white/40 hover:text-white transition-colors"
          >
            Fermer ✕
          </button>
        </header>

        <div className="grid gap-3 md:grid-cols-2 p-4 md:p-6">
          <ModalClipPanel
            label="Gauche"
            accent="var(--cyan)"
            thumb={match.kill_a_thumbnail}
            clipVertical={match.kill_a_clip_vertical}
            clipVerticalLow={match.kill_a_clip_vertical_low}
            killerName={match.kill_a_killer_name}
            killerChampion={match.kill_a_killer_champion}
            victimChampion={match.kill_a_victim_champion}
            aiDescription={match.kill_a_ai_description}
            highlightScore={match.kill_a_highlight_score}
            avgRating={match.kill_a_avg_rating}
            multiKill={match.kill_a_multi_kill}
            firstBlood={match.kill_a_first_blood}
            votes={match.votes_a}
            voted={voted === "a"}
            otherVoted={voted === "b"}
            onVote={() => castVote("a")}
            disabled={voting || disabledA || readOnly}
            alreadyVotedOnce={voted != null || alreadyVoted}
            prefersReducedMotion={prefersReducedMotion}
          />
          <ModalClipPanel
            label="Droite"
            accent="var(--gold)"
            thumb={match.kill_b_thumbnail}
            clipVertical={match.kill_b_clip_vertical}
            clipVerticalLow={match.kill_b_clip_vertical_low}
            killerName={match.kill_b_killer_name}
            killerChampion={match.kill_b_killer_champion}
            victimChampion={match.kill_b_victim_champion}
            aiDescription={match.kill_b_ai_description}
            highlightScore={match.kill_b_highlight_score}
            avgRating={match.kill_b_avg_rating}
            multiKill={match.kill_b_multi_kill}
            firstBlood={match.kill_b_first_blood}
            votes={match.votes_b}
            voted={voted === "b"}
            otherVoted={voted === "a"}
            onVote={() => castVote("b")}
            disabled={voting || disabledB || readOnly}
            alreadyVotedOnce={voted != null || alreadyVoted}
            prefersReducedMotion={prefersReducedMotion}
          />
        </div>

        {voteError && (
          <p className="mb-3 text-center text-xs text-[var(--red)] px-5">{voteError}</p>
        )}

        {(voted != null || alreadyVoted) && (
          <div className="px-5 pb-5">
            <div className="rounded-xl bg-black/30 border border-[var(--gold)]/30 p-4 text-center">
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)] mb-1">
                ✓ Vote enregistré
              </p>
              <p className="text-sm text-white/75">
                {voted != null
                  ? "Reviens demain pour le prochain round du tournoi."
                  : "Tu as déjà voté sur ce match — reviens demain pour la suite."}
              </p>
              <div className="mt-3 flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-white/20 bg-black/30 px-4 py-2 font-display text-[10px] font-bold uppercase tracking-[0.25em] text-white/75 hover:border-white/45 hover:text-white transition-colors"
                  aria-label="Continuer à explorer le bracket"
                >
                  Continuer le bracket
                </button>
              </div>
            </div>
          </div>
        )}
      </m.div>
    </m.div>
  );
}

function ModalClipPanel({
  label,
  accent,
  thumb,
  clipVertical,
  clipVerticalLow,
  killerName,
  killerChampion,
  victimChampion,
  aiDescription,
  highlightScore,
  avgRating,
  multiKill,
  firstBlood,
  votes,
  voted,
  otherVoted,
  onVote,
  disabled,
  alreadyVotedOnce,
  prefersReducedMotion,
}: {
  label: string;
  accent: string;
  thumb: string | null;
  clipVertical: string | null;
  clipVerticalLow: string | null;
  killerName: string | null;
  killerChampion: string | null;
  victimChampion: string | null;
  aiDescription: string | null;
  highlightScore: number | null;
  avgRating: number | null;
  multiKill: string | null;
  firstBlood: boolean;
  votes: number;
  voted: boolean;
  otherVoted: boolean;
  onVote: () => void;
  disabled: boolean;
  alreadyVotedOnce: boolean;
  prefersReducedMotion: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoUrl = clipVerticalLow ?? clipVertical ?? null;

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !videoUrl) return;
    el.muted = true;
    el.playsInline = true;
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        /* autoplay blocked — user can tap */
      });
    }
  }, [videoUrl]);

  return (
    <m.div
      animate={
        prefersReducedMotion
          ? undefined
          : { opacity: otherVoted ? 0.5 : 1, scale: voted ? 1.02 : 1 }
      }
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-xl border overflow-hidden bg-black/40"
      style={{
        borderColor: voted ? "var(--gold-bright)" : `${accent}55`,
        boxShadow: voted
          ? "0 22px 50px rgba(0,0,0,0.5), 0 0 60px rgba(240,230,210,0.4), 0 0 0 2px var(--gold-bright)"
          : `0 16px 38px rgba(0,0,0,0.45), 0 0 0 1px ${accent}25`,
      }}
    >
      <div className="relative" style={{ aspectRatio: "9 / 16", maxHeight: 480 }}>
        {videoUrl ? (
          <video
            ref={videoRef}
            src={videoUrl}
            poster={thumb ?? undefined}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
            aria-label={`Clip ${label} : ${killerName ?? killerChampion ?? "?"}`}
          />
        ) : thumb ? (
          <Image src={thumb} alt={`Clip ${label}`} fill sizes="(max-width: 768px) 50vw, 400px" className="object-cover" />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/35 text-xs">
            Clip indisponible
          </div>
        )}

        <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2">
          <span
            className="rounded-md px-2 py-0.5 text-[9px] font-data font-bold uppercase tracking-widest"
            style={{
              color: accent,
              backgroundColor: "rgba(0,0,0,0.55)",
              border: `1px solid ${accent}55`,
              backdropFilter: "blur(4px)",
            }}
          >
            {label}
          </span>
          <div className="flex items-center gap-1.5">
            {multiKill && (
              <span className="rounded-md bg-[var(--orange)]/25 border border-[var(--orange)]/45 px-1.5 py-0.5 text-[9px] font-data font-bold uppercase tracking-widest text-[var(--orange)]">
                {multiKill}
              </span>
            )}
            {firstBlood && (
              <span className="rounded-md bg-[var(--red)]/25 border border-[var(--red)]/45 px-1.5 py-0.5 text-[9px] font-data font-bold uppercase tracking-widest text-[var(--red)]">
                FB
              </span>
            )}
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/65 to-transparent pt-12 pb-3 px-4">
          <p className="font-display text-base font-black text-white leading-tight">
            <span style={{ color: accent }}>{killerName ?? killerChampion ?? "?"}</span>{" "}
            <span className="text-white/70">{killerChampion}</span>
          </p>
          <p className="text-[11px] text-white/65 mt-0.5">
            → {victimChampion ?? "?"}
          </p>
          {aiDescription && (
            <p className="text-[11px] text-white/55 mt-1.5 line-clamp-2">
              {aiDescription}
            </p>
          )}
        </div>
      </div>

      <div className="px-3 py-3 border-t border-white/10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-data text-[10px] uppercase tracking-widest text-white/45">
          {typeof highlightScore === "number" && (
            <span className="text-[var(--gold)]">IA {highlightScore.toFixed(1)}</span>
          )}
          {typeof avgRating === "number" && avgRating > 0 && (
            <span>★ {avgRating.toFixed(1)}</span>
          )}
        </div>
        <m.span
          animate={prefersReducedMotion ? undefined : { scale: voted ? 1.1 : 1 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="font-display text-base font-black"
          style={{ color: voted ? "var(--gold-bright)" : "var(--text-primary)" }}
        >
          {votes} vote{votes > 1 ? "s" : ""}
        </m.span>
      </div>

      <button
        type="button"
        onClick={onVote}
        disabled={disabled || alreadyVotedOnce}
        aria-label={`Voter pour ${killerName ?? killerChampion ?? "ce clip"}`}
        className="w-full py-3 font-display text-xs font-black uppercase tracking-[0.25em] border-t transition-all disabled:cursor-not-allowed"
        style={{
          background: voted
            ? `linear-gradient(135deg, var(--gold-bright), var(--gold))`
            : alreadyVotedOnce
              ? "rgba(0,0,0,0.3)"
              : `${accent}18`,
          color: voted ? "var(--bg-primary)" : alreadyVotedOnce ? "rgba(255,255,255,0.35)" : accent,
          borderColor: voted ? "var(--gold-bright)" : `${accent}45`,
          opacity: alreadyVotedOnce && !voted ? 0.45 : 1,
        }}
      >
        {voted ? "✓ Tu as voté ici" : alreadyVotedOnce ? "Vote déjà placé" : "Celui-ci"}
      </button>
    </m.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Past winners gallery (footer)
// ════════════════════════════════════════════════════════════════════

function PastWinnersGallery({
  winners,
  currentSlug,
}: {
  winners: PastWinner[];
  currentSlug: string;
}) {
  const filtered = winners.filter((w) => w.slug !== currentSlug);
  if (filtered.length === 0) return null;
  return (
    <section
      aria-labelledby="bracket-past-winners"
      className="mx-auto max-w-6xl px-4 md:px-6 pb-16 pt-8 md:pt-12"
    >
      <div className="flex items-center gap-3 mb-6" id="bracket-past-winners">
        <span className="h-px w-12 bg-[var(--gold)]" />
        <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
          Galerie des GOATs
        </span>
        <span className="text-[var(--gold)]/40 text-xs" aria-hidden>
          ◆
        </span>
      </div>
      <div className="flex gap-3 md:gap-4 overflow-x-auto pb-3" style={{ scrollSnapType: "x mandatory" }}>
        {filtered.map((w) => (
          <Link
            key={w.tournament_id}
            href={`/bracket/${w.slug}`}
            className="group flex-shrink-0 rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)]/70 backdrop-blur-md overflow-hidden transition-all hover:border-[var(--gold)]/70 hover:-translate-y-0.5"
            style={{
              width: 220,
              scrollSnapAlign: "start",
              boxShadow: "0 12px 28px rgba(0,0,0,0.4)",
            }}
            aria-label={`Voir le bracket ${w.name}`}
          >
            <div className="relative bg-black/40" style={{ aspectRatio: "16 / 9" }}>
              {w.champion_thumbnail ? (
                <Image
                  src={w.champion_thumbnail}
                  alt={`Champion ${w.name}`}
                  fill
                  sizes="220px"
                  className="object-cover group-hover:scale-105 transition-transform"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-white/30 font-display text-3xl">
                  ♛
                </div>
              )}
              <span
                className="absolute top-2 left-2 rounded-md px-1.5 py-0.5 text-[9px] font-data font-black uppercase tracking-widest"
                style={{
                  color: "var(--bg-primary)",
                  background: "linear-gradient(135deg, var(--gold-bright), var(--gold))",
                }}
              >
                ♛ GOAT
              </span>
            </div>
            <div className="px-3 py-3">
              <p className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/80">
                {w.name.replace("Tournoi du Mois — ", "")}
              </p>
              <p className="mt-1 font-display text-sm font-black text-[var(--text-primary)] leading-tight truncate">
                {w.champion_killer_name ?? w.champion_killer_champion ?? "—"}
              </p>
              <p className="font-data text-[10px] uppercase tracking-widest text-white/45 truncate">
                {w.champion_killer_champion ?? "?"}
                {w.champion_victim_champion ? <> · vs {w.champion_victim_champion}</> : null}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Date helpers — French formatting, no external i18n dep
// ════════════════════════════════════════════════════════════════════

function formatDateRange(start: string, end: string): string {
  try {
    const s = new Date(`${start}T00:00:00Z`);
    const e = new Date(`${end}T00:00:00Z`);
    const fmt = (d: Date) =>
      d.toLocaleDateString("fr-FR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
    return `${fmt(s)} → ${fmt(e)}`;
  } catch {
    return `${start} → ${end}`;
  }
}

function formatRelative(iso: string): string {
  try {
    const target = new Date(iso).getTime();
    if (!Number.isFinite(target)) return "bientôt";
    const diff = target - Date.now();
    const absMs = Math.abs(diff);
    const sign = diff < 0 ? "il y a " : "dans ";
    const min = Math.round(absMs / 60_000);
    if (min < 60) return `${sign}${min} min`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `${sign}${hours} h`;
    const days = Math.round(hours / 24);
    return `${sign}${days} j`;
  } catch {
    return "bientôt";
  }
}
