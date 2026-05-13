"use client";

/**
 * MatchTimeline (page-local, Wave 30d) — interactive per-game kill axis.
 *
 * Lives under `app/match/[slug]/` because it owns the entire replay
 * viewer's interactive lifecycle :
 *   - Renders ONE strip per game in the BO.
 *   - Each kill = a clickable dot positioned at
 *     `(game_time_seconds / max_game_time) * width`.
 *   - Gold dots = KC kills, dark-red dots = KC deaths.
 *   - Hover (desktop) or long-press (mobile, 300 ms) → tooltip with
 *     thumbnail + matchup + score.
 *   - Click → opens the page-local KillSidePanel (slide-in side panel
 *     on desktop, bottom sheet on mobile).
 *   - Multi-kills get a gold ring, first-blood gets a 🩸 marker, dot
 *     size scales with highlight_score (>7 → 16 px, 4-7 → 12 px,
 *     <4 → 8 px).
 *   - Stagger-fades the dots in on mount (Motion `staggerChildren` 30 ms)
 *     unless prefers-reduced-motion: reduce.
 *
 * Distinct from the legacy `components/match/MatchTimeline.tsx` which
 * still ships the v1 lightbox-based UX. The Wave-30 replay viewer
 * uses this page-local variant + KillSidePanel for a richer "Sofascore
 * post-match" feel without breaking the old component for callers
 * elsewhere on the site.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { motion } from "motion/react";
import { pickAssetUrl } from "@/lib/kill-assets";
import type { PublishedKillRow } from "@/lib/supabase/kills";
import { KillSidePanel } from "./KillSidePanel";

// ─── Types ────────────────────────────────────────────────────────────

export interface MatchTimelineGame {
  id: string;
  number: number;
  durationSeconds: number | null;
  /** Optional pre-computed KC kill count for the strip header. */
  kcKills: number;
  oppKills: number;
}

export interface MatchTimelineProps {
  games: MatchTimelineGame[];
  kills: PublishedKillRow[];
  opponentCode: string;
  opponentName: string;
  /** Optional scroll-target id for the "scroll to game" header pills. */
  anchorPrefix?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatGameTime(seconds: number | null): string {
  if (seconds == null) return "??:??";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

function sizeClass(score: number | null): string {
  if (score == null || score < 4) return "h-2 w-2";
  if (score < 7) return "h-3 w-3";
  return "h-4 w-4";
}

function dotColors(involvement: string | null): {
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

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduced;
}

// ─── Component ────────────────────────────────────────────────────────

export function MatchTimeline({
  games,
  kills,
  opponentCode,
  opponentName,
  anchorPrefix = "game",
}: MatchTimelineProps) {
  // Flatten kills in chronological order — feeds the side panel's
  // prev/next cycling and the roving-tabindex keyboard navigation.
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

  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard nav — arrow keys cycle across game strips.
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
        const el = containerRef.current?.querySelector<HTMLButtonElement>(
          `[data-kill-idx="${next}"]`,
        );
        el?.focus();
      } else if (e.key === "Enter" || e.key === " ") {
        if (focusedIdx >= 0) {
          e.preventDefault();
          setActiveIdx(focusedIdx);
        }
      }
    },
    [orderedKills.length, focusedIdx],
  );

  if (orderedKills.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center text-xs text-[var(--text-muted)]">
        Aucun clip vidéo disponible pour ce match.
      </div>
    );
  }

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
          // Floor the denominator at 20 min so a dot-cluster on an
          // early FB doesn't squash the strip to the left edge.
          const maxGameTime = Math.max(
            game.durationSeconds ?? 0,
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
              setActiveIdx={setActiveIdx}
              anchorPrefix={anchorPrefix}
            />
          );
        })}
      </div>

      <KillSidePanel
        kills={orderedKills}
        activeIdx={activeIdx}
        opponentName={opponentName}
        opponentCode={opponentCode}
        onClose={() => setActiveIdx(null)}
        onChange={(idx) => setActiveIdx(idx)}
      />

      {/* Screen-reader-only fallback table of every kill in the match.
          Lets a screen-reader user navigate the timeline data without
          relying on the dot positions. */}
      <table className="sr-only">
        <caption>Liste des kills du match en ordre chronologique</caption>
        <thead>
          <tr>
            <th scope="col">Game</th>
            <th scope="col">Temps</th>
            <th scope="col">Tueur</th>
            <th scope="col">Champion tueur</th>
            <th scope="col">Victime</th>
            <th scope="col">Champion victime</th>
            <th scope="col">Score IA</th>
            <th scope="col">Camp KC</th>
          </tr>
        </thead>
        <tbody>
          {orderedKills.map((k) => (
            <tr key={`sr-${k.id}`}>
              <td>Game {k.games?.game_number ?? "?"}</td>
              <td>{formatGameTime(k.game_time_seconds)}</td>
              <td>—</td>
              <td>{k.killer_champion ?? "?"}</td>
              <td>—</td>
              <td>{k.victim_champion ?? "?"}</td>
              <td>{k.highlight_score?.toFixed(1) ?? "—"}</td>
              <td>
                {k.tracked_team_involvement === "team_killer"
                  ? "KC tueur"
                  : k.tracked_team_involvement === "team_victim"
                    ? "KC victime"
                    : "Neutre"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ─── GameStrip ────────────────────────────────────────────────────────

interface GameStripProps {
  game: MatchTimelineGame;
  gameKills: PublishedKillRow[];
  startIdx: number;
  maxGameTime: number;
  opponentCode: string;
  focusedIdx: number;
  setFocusedIdx: (idx: number) => void;
  setActiveIdx: (idx: number) => void;
  anchorPrefix: string;
}

function GameStrip({
  game,
  gameKills,
  startIdx,
  maxGameTime,
  opponentCode,
  focusedIdx,
  setFocusedIdx,
  setActiveIdx,
  anchorPrefix,
}: GameStripProps) {
  const reducedMotion = usePrefersReducedMotion();
  const totalMinutes = Math.max(20, Math.ceil(maxGameTime / 60));
  const tickInterval = totalMinutes <= 25 ? 5 : totalMinutes <= 35 ? 10 : 15;
  const ticks: number[] = [];
  for (let m = 0; m <= totalMinutes; m += tickInterval) ticks.push(m);

  const kcCount = gameKills.filter(
    (k) => k.tracked_team_involvement === "team_killer",
  ).length;
  const oppCount = gameKills.filter(
    (k) => k.tracked_team_involvement === "team_victim",
  ).length;

  const stripContainer = reducedMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0 },
        show: {
          opacity: 1,
          transition: { staggerChildren: 0.03, delayChildren: 0.05 },
        },
      };
  const dotItem = reducedMotion
    ? { hidden: { opacity: 1 }, show: { opacity: 1 } }
    : {
        hidden: { opacity: 0, scale: 0.4 },
        show: {
          opacity: 1,
          scale: 1,
          transition: { type: "spring" as const, stiffness: 360, damping: 22 },
        },
      };

  return (
    <div
      id={`${anchorPrefix}-${game.number}`}
      className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden scroll-mt-32"
    >
      <div className="flex items-center justify-between border-b border-[var(--border-gold)] bg-[var(--bg-primary)] px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-display text-xs font-bold uppercase tracking-widest text-[var(--gold)]">
            Game {game.number}
          </span>
          <span className="font-data text-[11px] text-[var(--text-muted)]">
            <span className="font-bold text-[var(--green)]">{game.kcKills}</span>
            {" - "}
            <span className="font-bold text-[var(--red)]">
              {game.oppKills}
            </span>
          </span>
          {game.durationSeconds ? (
            <span className="font-data text-[10px] text-[var(--text-muted)]">
              · {formatGameTime(game.durationSeconds)}
            </span>
          ) : null}
        </div>
        <span className="font-data text-[10px] uppercase tracking-widest text-[var(--gold)]/70">
          {gameKills.length} clip{gameKills.length > 1 ? "s" : ""}
        </span>
      </div>

      <motion.div
        className="relative h-14 select-none px-3 sm:h-20"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.2 }}
        variants={stripContainer}
      >
        {/* Tick marks */}
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

        {/* Baselines */}
        <div className="absolute left-3 right-3 top-[38%] h-px bg-[var(--gold)]/30" />
        <div className="absolute left-3 right-3 top-[68%] h-px bg-[var(--red)]/30" />

        {/* Side labels */}
        <div className="pointer-events-none absolute left-3 top-0 bottom-0 flex flex-col justify-center gap-3 pl-0.5 font-data text-[8px] uppercase tracking-widest">
          <span className="text-[var(--gold)]/60">KC</span>
          <span className="text-[var(--red)]/60">{opponentCode}</span>
        </div>

        {/* Dots */}
        {gameKills.map((k, localIdx) => {
          const globalIdx = startIdx + localIdx;
          const t = k.game_time_seconds ?? 0;
          const leftPct = Math.max(
            0,
            Math.min(100, (t / maxGameTime) * 100),
          );
          const isKc = k.tracked_team_involvement === "team_killer";
          const top = isKc ? "38%" : "68%";
          return (
            <motion.div
              key={k.id}
              className="absolute"
              style={{ left: `calc(${leftPct}% + 0.75rem)`, top }}
              variants={dotItem}
            >
              <Dot
                kill={k}
                opponentCode={opponentCode}
                isFocused={focusedIdx === globalIdx}
                tabbable={
                  focusedIdx === -1
                    ? localIdx === 0 && startIdx === 0
                    : focusedIdx === globalIdx
                }
                dataIdx={globalIdx}
                onFocus={() => setFocusedIdx(globalIdx)}
                onActivate={() => setActiveIdx(globalIdx)}
              />
            </motion.div>
          );
        })}

        <div className="sr-only">
          Timeline du Game {game.number}: {gameKills.length} kills, dont{" "}
          {kcCount} pour KC et {oppCount} pour {opponentCode}.
        </div>
      </motion.div>
    </div>
  );
}

// ─── Dot ──────────────────────────────────────────────────────────────

interface DotProps {
  kill: PublishedKillRow;
  opponentCode: string;
  isFocused: boolean;
  tabbable: boolean;
  dataIdx: number;
  onFocus: () => void;
  onActivate: () => void;
}

function Dot({
  kill,
  opponentCode,
  isFocused,
  tabbable,
  dataIdx,
  onFocus,
  onActivate,
}: DotProps) {
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);

  const colors = dotColors(kill.tracked_team_involvement);
  const size = sizeClass(kill.highlight_score);
  const hasMulti = !!kill.multi_kill;
  const isFb = kill.is_first_blood;

  const title = `Kill : ${kill.killer_champion ?? "?"} tue ${kill.victim_champion ?? "?"} à T+${formatGameTime(kill.game_time_seconds)}${
    hasMulti ? ` (${kill.multi_kill})` : ""
  }${isFb ? " — Premier sang" : ""}${
    kill.tracked_team_involvement === "team_victim"
      ? ` (kill de ${opponentCode})`
      : ""
  }`;

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
      if (longPressTimer.current != null) {
        window.clearTimeout(longPressTimer.current);
      }
    };
  }, []);

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
      className={`-translate-x-1/2 -translate-y-1/2 relative rounded-full border-2 transition-transform duration-200 hover:scale-150 focus-visible:scale-150 focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:outline-none ${size} ${colors.bg} ${colors.border} ${colors.shadow} ${
        hasMulti ? "ring-2 ring-[var(--gold)]/40" : ""
      } ${isFocused ? "scale-150 z-10" : ""}`}
    >
      {isFb && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-3 left-1/2 -translate-x-1/2 text-[10px] leading-none"
          title="Premier sang"
        >
          {"🩸"}
        </span>
      )}
      {tooltipOpen && (
        <DotTooltip
          kill={kill}
          thumbnailUrl={thumbnailUrl}
          opponentCode={opponentCode}
        />
      )}
    </button>
  );
}

// ─── Tooltip ──────────────────────────────────────────────────────────

function DotTooltip({
  kill,
  thumbnailUrl,
  opponentCode,
}: {
  kill: PublishedKillRow;
  thumbnailUrl: string | null;
  opponentCode: string;
}) {
  const isKc = kill.tracked_team_involvement === "team_killer";
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-3 w-48 -translate-x-1/2 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-elevated)] p-2 text-left shadow-xl sm:w-56"
    >
      {thumbnailUrl ? (
        <div className="relative mb-1.5 h-20 w-full overflow-hidden rounded">
          <Image
            src={thumbnailUrl}
            alt=""
            fill
            sizes="(max-width: 640px) 192px, 224px"
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
