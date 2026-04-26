"use client";

/**
 * MatchTimeline — interactive scrubbable timeline for /match/[slug].
 *
 * Replaces the static dot-strip from the page-local `RealKillTimeline`
 * with a richer, fully interactive surface:
 *   - one horizontal strip per game in the BO
 *   - dot positioning: `(game_time_seconds / max_game_time) * width`
 *     (max_game_time is the latest kill in that game, floored to 20 min
 *     so early-only data doesn't cluster the strip on the left edge)
 *   - dot color : KC kill (`team_killer`) → gold, KC death
 *     (`team_victim`) → red, neutral / unknown → muted text
 *   - dot size scales with `highlight_score` :
 *       null / <4   → w-2 (8px)
 *       4 – 7       → w-3 (12px)
 *       >7          → w-4 (16px)
 *   - multi-kill dots get a glow ring (ring-2 ring-[var(--gold)]/40)
 *   - first blood gets a 🩸 marker above the dot
 *   - hover (desktop) → poster tooltip (thumbnail + champion matchup +
 *     score). Long-press (mobile, 300ms) → same tooltip.
 *   - click → opens a `KillLightbox` modal with the clip auto-playing.
 *   - keyboard nav : the strip is a roving-tabindex group of dots ;
 *     ArrowLeft / ArrowRight cycles through the dots in chronological
 *     order across games (so the user can keyboard-walk the BO end to
 *     end), Enter opens the lightbox, Esc closes.
 *
 * Mobile-first per CLAUDE.md (375px design target). Strip height is
 * h-12 on mobile, h-16 from sm: up — small enough to keep the timeline
 * skim-able even on a Pixel-sized viewport.
 *
 * The lightbox is rendered AT THIS COMPONENT LEVEL (not portaled up to
 * the document root) — `position: fixed inset-0` does the right thing
 * regardless of where it lives, and keeping the modal local means the
 * focus-trap, body-scroll lock, and Esc handler all share the same
 * React-state lifecycle as the dots that opened it. No extra provider
 * needed at the page or layout level.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { pickAssetUrl } from "@/lib/kill-assets";
import type { PublishedKillRow } from "@/lib/supabase/kills";
import { KillLightbox } from "./KillLightbox";

// ─── Types ────────────────────────────────────────────────────────────

export interface TimelineGame {
  /** External id from the lolesports API. */
  id: string;
  /** 1-indexed game number within the BO (1, 2, 3, …). */
  number: number;
  /** Total KC kills in the game (from the page's RealGame). */
  kc_kills: number;
  /** Total opponent kills in the game. */
  opp_kills: number;
}

export interface MatchTimelineProps {
  games: TimelineGame[];
  kills: PublishedKillRow[];
  /** 3-letter opponent code, e.g. "G2" — used in side labels + a11y. */
  opponentCode: string;
  /** Opponent full name, e.g. "G2 Esports" — used in the lightbox title. */
  opponentName: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatGameTime(seconds: number | null): string {
  if (seconds == null) return "??:??";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

/**
 * Bucket the highlight score into the three Tailwind dot sizes.
 *
 *   null / <4   → 8 px  → w-2 h-2
 *   4 – 7       → 12 px → w-3 h-3
 *   >7          → 16 px → w-4 h-4
 *
 * Returning the class strings (vs. inline width/height styles) keeps
 * Tailwind's tree-shaker happy — these literal class names ship in
 * the production CSS bundle.
 */
function sizeClass(score: number | null): string {
  if (score == null || score < 4) return "h-2 w-2";
  if (score < 7) return "h-3 w-3";
  return "h-4 w-4";
}

/** Tailwind color classes for the dot fill, keyed by KC involvement. */
function colorClasses(involvement: string | null): {
  bg: string;
  border: string;
  shadow: string;
} {
  if (involvement === "team_killer") {
    return {
      bg: "bg-[var(--gold)]",
      border: "border-[var(--gold)]",
      shadow: "shadow-[0_0_10px_rgba(200,170,110,0.7)]",
    };
  }
  if (involvement === "team_victim") {
    return {
      bg: "bg-[var(--red)]",
      border: "border-[var(--red)]/70",
      shadow: "shadow-[0_0_8px_rgba(232,64,87,0.55)]",
    };
  }
  return {
    bg: "bg-[var(--text-muted)]",
    border: "border-[var(--text-muted)]/70",
    shadow: "",
  };
}

// ─── Component ────────────────────────────────────────────────────────

export function MatchTimeline({
  games,
  kills,
  opponentCode,
  opponentName,
}: MatchTimelineProps) {
  // The flat, chronological list of all kills in the BO — used for
  // the keyboard arrow-nav across games and for the lightbox's
  // prev/next cycling. Sorted by (game_number, game_time_seconds) so
  // the order matches what the user sees on screen.
  const orderedKills = useMemo<PublishedKillRow[]>(() => {
    const byGame = new Map<number, PublishedKillRow[]>();
    for (const k of kills) {
      const n = k.games?.game_number ?? 1;
      const bucket = byGame.get(n) ?? [];
      bucket.push(k);
      byGame.set(n, bucket);
    }
    for (const bucket of byGame.values()) {
      bucket.sort(
        (a, b) => (a.game_time_seconds ?? 0) - (b.game_time_seconds ?? 0),
      );
    }
    const out: PublishedKillRow[] = [];
    for (const g of games) {
      const bucket = byGame.get(g.number);
      if (bucket) out.push(...bucket);
    }
    return out;
  }, [games, kills]);

  // Index of the kill the lightbox is currently focused on. null = closed.
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  // Index of the dot currently focused via keyboard. -1 = no focus.
  // Used to drive the roving-tabindex pattern (only one dot is
  // tabbable at a time; arrow keys move the focus within the group).
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);

  const containerRef = useRef<HTMLDivElement>(null);

  // ─── Keyboard nav ──────────────────────────────────────────────────
  // Captured on the wrapping container so the user can land on any
  // dot then drive the timeline with the arrow keys without losing
  // the roving focus when crossing game boundaries.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (orderedKills.length === 0) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const dir = e.key === "ArrowRight" ? 1 : -1;
        const cur = focusedIdx < 0 ? 0 : focusedIdx;
        const next = Math.max(
          0,
          Math.min(orderedKills.length - 1, cur + dir),
        );
        setFocusedIdx(next);
        // Move actual DOM focus so screen readers announce the dot
        // and so the next Enter / Space hits the right element.
        const el = containerRef.current?.querySelector<HTMLButtonElement>(
          `[data-kill-idx="${next}"]`,
        );
        el?.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        if (focusedIdx >= 0) {
          e.preventDefault();
          setLightboxIdx(focusedIdx);
        }
      }
    },
    [orderedKills.length, focusedIdx],
  );

  // ─── Render ────────────────────────────────────────────────────────

  if (kills.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center text-xs text-[var(--text-muted)]">
        Aucun clip vidéo disponible pour ce match.
      </div>
    );
  }

  // Track the running "kill index" as we walk games top-to-bottom so
  // each dot knows its position in `orderedKills` (used by the focus
  // ring + the lightbox open handler). The nested IIFE keeps the
  // accumulator out of the JSX.
  let runningIdx = 0;

  return (
    <>
      <div
        ref={containerRef}
        onKeyDown={onKeyDown}
        className="space-y-4"
        role="group"
        aria-label="Timeline interactive des kills du match"
      >
        {games.map((game) => {
          const gameKills = orderedKills.filter(
            (k) => (k.games?.game_number ?? 1) === game.number,
          );
          if (gameKills.length === 0) {
            // Don't render an empty strip for games with no clips —
            // prevents a confusing "Game 3" row with nothing on it.
            // The page still shows the player tables for context.
            return null;
          }
          // Floor the denominator to 20 min so a game where the only
          // clip is at minute 6 doesn't collapse all dots into a tiny
          // 100% segment on the left edge.
          const maxGameTime = Math.max(
            ...gameKills.map((k) => k.game_time_seconds ?? 0),
            60 * 20,
          );
          const startIdx = runningIdx;
          runningIdx += gameKills.length;

          return (
            <GameStrip
              key={game.id}
              game={game}
              gameKills={gameKills}
              startIdx={startIdx}
              maxGameTime={maxGameTime}
              opponentCode={opponentCode}
              focusedIdx={focusedIdx}
              setFocusedIdx={setFocusedIdx}
              setLightboxIdx={setLightboxIdx}
            />
          );
        })}
      </div>

      {lightboxIdx !== null && (
        <KillLightbox
          kills={orderedKills}
          activeIdx={lightboxIdx}
          opponentName={opponentName}
          onClose={() => setLightboxIdx(null)}
          onChange={(idx) => setLightboxIdx(idx)}
        />
      )}
    </>
  );
}

// ─── GameStrip — one horizontal timeline per game ─────────────────────

interface GameStripProps {
  game: TimelineGame;
  gameKills: PublishedKillRow[];
  /** Offset into the parent's flat orderedKills array — added to each
   *  dot's local index so the lightbox + roving focus see the right
   *  global position. */
  startIdx: number;
  maxGameTime: number;
  opponentCode: string;
  focusedIdx: number;
  setFocusedIdx: (idx: number) => void;
  setLightboxIdx: (idx: number) => void;
}

function GameStrip({
  game,
  gameKills,
  startIdx,
  maxGameTime,
  opponentCode,
  focusedIdx,
  setFocusedIdx,
  setLightboxIdx,
}: GameStripProps) {
  const totalMinutes = Math.max(20, Math.ceil(maxGameTime / 60));
  const tickInterval = totalMinutes <= 25 ? 5 : 10;
  const ticks: number[] = [];
  for (let m = 0; m <= totalMinutes; m += tickInterval) ticks.push(m);

  const kcCount = gameKills.filter(
    (k) => k.tracked_team_involvement === "team_killer",
  ).length;
  const oppCount = gameKills.filter(
    (k) => k.tracked_team_involvement === "team_victim",
  ).length;

  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
      <div className="flex items-center justify-between border-b border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs font-bold uppercase tracking-widest text-[var(--gold)]">
            Game {game.number}
          </span>
          <span className="font-data text-[11px] text-[var(--text-muted)]">
            <span className="font-bold text-[var(--green)]">{game.kc_kills}</span>
            {" - "}
            <span className="font-bold text-[var(--red)]">{game.opp_kills}</span>
          </span>
        </div>
        <span className="font-data text-[10px] uppercase tracking-widest text-[var(--gold)]/70">
          {gameKills.length} clip{gameKills.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="relative h-12 select-none px-3 sm:h-16">
        {/* Tick marks (vertical, behind dots) */}
        {ticks.map((m) => {
          const leftPct = Math.min(100, ((m * 60) / maxGameTime) * 100);
          return (
            <div
              key={`t-${m}`}
              className="pointer-events-none absolute top-2 bottom-2 w-px bg-white/[0.05]"
              style={{ left: `calc(${leftPct}% + 0.75rem)` }}
            >
              <span className="absolute -top-0.5 -translate-x-1/2 font-data text-[8px] uppercase tracking-widest text-white/30">
                {m}&apos;
              </span>
            </div>
          );
        })}

        {/* KC baseline (gold) — sits above the visual centre */}
        <div className="absolute left-3 right-3 top-[40%] h-px bg-[var(--gold)]/35" />
        {/* Opp baseline (red) — sits below the visual centre */}
        <div className="absolute left-3 right-3 top-[68%] h-px bg-[var(--red)]/35" />

        {/* Dots */}
        {gameKills.map((k, localIdx) => {
          const globalIdx = startIdx + localIdx;
          const t = k.game_time_seconds ?? 0;
          // Inset by px-3 (0.75rem) so the dot positioning lines up
          // with the inset baselines + ticks above.
          const leftPct = Math.max(
            0,
            Math.min(100, (t / maxGameTime) * 100),
          );
          const isKc = k.tracked_team_involvement === "team_killer";
          const top = isKc ? "40%" : "68%";
          return (
            <Dot
              key={k.id}
              kill={k}
              leftPct={leftPct}
              top={top}
              opponentCode={opponentCode}
              isFocused={focusedIdx === globalIdx}
              tabbable={focusedIdx === -1 ? localIdx === 0 && startIdx === 0 : focusedIdx === globalIdx}
              dataIdx={globalIdx}
              onFocus={() => setFocusedIdx(globalIdx)}
              onActivate={() => setLightboxIdx(globalIdx)}
            />
          );
        })}

        {/* Side labels — left edge */}
        <div className="pointer-events-none absolute left-3 top-0 bottom-0 flex flex-col justify-center gap-3 pl-0.5 font-data text-[8px] uppercase tracking-widest">
          <span className="text-[var(--gold)]/60">KC</span>
          <span className="text-[var(--red)]/60">{opponentCode}</span>
        </div>

        <div className="sr-only">
          Timeline du Game {game.number}: {gameKills.length} kill
          {gameKills.length > 1 ? "s" : ""}, dont {kcCount} pour KC et{" "}
          {oppCount} pour {opponentCode}.
        </div>
      </div>
    </div>
  );
}

// ─── Dot — one clickable kill marker on the strip ─────────────────────

interface DotProps {
  kill: PublishedKillRow;
  leftPct: number;
  top: string;
  opponentCode: string;
  isFocused: boolean;
  tabbable: boolean;
  dataIdx: number;
  onFocus: () => void;
  onActivate: () => void;
}

function Dot({
  kill,
  leftPct,
  top,
  opponentCode,
  isFocused,
  tabbable,
  dataIdx,
  onFocus,
  onActivate,
}: DotProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);

  const colors = colorClasses(kill.tracked_team_involvement);
  const size = sizeClass(kill.highlight_score);
  const hasMulti = !!kill.multi_kill;
  const isFb = kill.is_first_blood;

  const title = `T+${formatGameTime(kill.game_time_seconds)} — ${
    kill.killer_champion ?? "?"
  } élimine ${kill.victim_champion ?? "?"}${
    hasMulti ? ` (${kill.multi_kill})` : ""
  }${isFb ? " — Premier sang" : ""}${
    kill.tracked_team_involvement === "team_victim"
      ? ` (kill de ${opponentCode})`
      : ""
  }`;

  // Long-press for mobile : 300 ms touch-hold opens the tooltip.
  // Releasing or moving cancels.
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (e.pointerType !== "touch") return;
      longPressTimer.current = window.setTimeout(() => {
        setTooltipOpen(true);
      }, 300);
    },
    [],
  );
  const cancelLongPress = useCallback(() => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      // Belt + braces : if the dot unmounts mid-press, drop the timer.
      if (longPressTimer.current != null) {
        window.clearTimeout(longPressTimer.current);
      }
    };
  }, []);

  // Auto-close the tooltip on outside touch (mobile UX). Desktop
  // closes on mouseleave via the JSX handler below.
  useEffect(() => {
    if (!tooltipOpen) return;
    const onTouchOutside = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest(`[data-kill-tooltip-for="${dataIdx}"]`)) {
        setTooltipOpen(false);
      }
    };
    document.addEventListener("touchstart", onTouchOutside, { passive: true });
    return () =>
      document.removeEventListener("touchstart", onTouchOutside);
  }, [tooltipOpen, dataIdx]);

  const thumbnailUrl = pickAssetUrl(kill, "thumbnail");

  return (
    <button
      type="button"
      data-kill-idx={dataIdx}
      data-kill-tooltip-for={dataIdx}
      tabIndex={tabbable ? 0 : -1}
      aria-label={title}
      title={title}
      onFocus={() => {
        onFocus();
        setTooltipOpen(true);
      }}
      onBlur={() => setTooltipOpen(false)}
      onMouseEnter={() => setTooltipOpen(true)}
      onMouseLeave={() => setTooltipOpen(false)}
      onPointerDown={onPointerDown}
      onPointerUp={cancelLongPress}
      onPointerLeave={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onClick={() => onActivate()}
      style={{ left: `calc(${leftPct}% + 0.75rem)`, top }}
      className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-transform duration-150 hover:scale-150 focus-visible:scale-150 focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:outline-none ${size} ${colors.bg} ${colors.border} ${colors.shadow} ${
        hasMulti ? "ring-2 ring-[var(--gold)]/40" : ""
      } ${isFocused ? "scale-150 z-10" : ""}`}
    >
      {/* First-blood marker — tiny drop above the dot */}
      {isFb && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] leading-none"
          title="Premier sang"
        >
          {"\uD83E\uDE78"}
        </span>
      )}
      {tooltipOpen && (
        <KillTooltip
          kill={kill}
          thumbnailUrl={thumbnailUrl}
          opponentCode={opponentCode}
        />
      )}
    </button>
  );
}

// ─── KillTooltip — poster preview on hover / long-press ───────────────

interface KillTooltipProps {
  kill: PublishedKillRow;
  thumbnailUrl: string | null;
  opponentCode: string;
}

function KillTooltip({ kill, thumbnailUrl, opponentCode }: KillTooltipProps) {
  const isKc = kill.tracked_team_involvement === "team_killer";
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-44 -translate-x-1/2 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] p-2 text-left shadow-lg sm:w-52"
    >
      {thumbnailUrl ? (
        <div className="relative mb-1.5 h-20 w-full overflow-hidden rounded">
          <Image
            src={thumbnailUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 176px, 208px"
            className="object-cover"
            unoptimized
          />
        </div>
      ) : null}
      <p className="font-display text-[10px] font-bold uppercase tracking-widest text-[var(--gold)]">
        T+{formatGameTime(kill.game_time_seconds)}
        {kill.multi_kill ? ` · ${kill.multi_kill}` : ""}
        {kill.is_first_blood ? " · Premier sang" : ""}
      </p>
      <p className="mt-0.5 font-display text-xs font-semibold text-[var(--text-primary)]">
        <span className={isKc ? "text-[var(--gold)]" : "text-[var(--red)]"}>
          {kill.killer_champion ?? "?"}
        </span>{" "}
        →{" "}
        <span className={isKc ? "text-[var(--red)]" : "text-[var(--gold)]"}>
          {kill.victim_champion ?? "?"}
        </span>
      </p>
      <div className="mt-1 flex items-center justify-between text-[10px] text-[var(--text-muted)]">
        <span>
          Score{" "}
          <span className="font-data text-[var(--gold)]">
            {kill.highlight_score?.toFixed(1) ?? "—"}
          </span>
        </span>
        <span className="text-[10px] uppercase tracking-widest text-[var(--text-disabled)]">
          {isKc ? "KC" : opponentCode}
        </span>
      </div>
    </div>
  );
}
