"use client";

/**
 * KDAChart — per-game cumulative-kills evolution chart.
 *
 * Renders an SVG line chart with one series per player (5 KC in gold
 * tones, 5 enemy in red tones). The X axis is game time in minutes ;
 * the Y axis is cumulative kill count per player.
 *
 * Why cumulative kills (instead of full KDA = K+A) ?
 *   - Frame-by-frame assist data isn't reliably available in our `kills`
 *     table (assistants is a `JSONB` array but rarely populated for
 *     historical / gol_gg-sourced kills, see migration 001 line 161).
 *   - Kills are the cleanest signal we have per kill row, and the chart
 *     answers the question fans actually care about post-match :
 *     "When did each player start carrying ?". A flatlining line vs a
 *     steep climb tells the story without needing assist data.
 *
 * The chart is hand-rolled SVG (no chart library) :
 *   - No layout shift on mount — width is computed from the parent ref.
 *   - prefers-reduced-motion : the line dashOffset draw-in animation is
 *     skipped entirely, lines render fully on first paint.
 *   - Lines stroke-dasharray draw-in 600 ms on mount.
 *   - Each series legend item is keyboard-focusable + toggles the line
 *     visibility (helpful when one player has 12 kills and others have 1
 *     each — let the user mute the carry to see the rest).
 *
 * Accessibility :
 *   - Wraps the chart in a `role="figure"` with an `aria-label`.
 *   - Ships a screen-reader-only `<table>` fallback with the full kill
 *     timeline for each player so a SR user can read the data without
 *     parsing the SVG.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { PublishedKillRow } from "@/lib/supabase/kills";

// ─── Types ────────────────────────────────────────────────────────────

export interface KDAChartPlayer {
  /** Display name (IGN). */
  ign: string;
  /** Champion this player rode for this game. */
  champion: string;
  /** Side. Drives the color palette. */
  side: "kc" | "opp";
  /** Optional final KDA used by the table fallback + legend hover. */
  kdaLabel?: string;
}

export interface KDAChartProps {
  /** Game number (1, 2, 3…) — used in chart titles + aria. */
  gameNumber: number;
  /** Duration of the game in seconds — caps the X axis. */
  durationSeconds: number | null;
  /** Players (10 total). The order drives legend ordering. */
  players: KDAChartPlayer[];
  /** Kills of this game in chronological order. */
  kills: PublishedKillRow[];
}

// ─── Colour palettes ──────────────────────────────────────────────────
//
// KC gold variants — bright on the carry, softer for support roles so
// you can read all 5 lines without them blending. Enemy in red variants
// for the same reason.

const KC_PALETTE = [
  "#F0E6D2", // gold-bright
  "#C8AA6E", // gold
  "#E8C66A",
  "#A88543",
  "#FFD27A",
];
const OPP_PALETTE = [
  "#E84057", // primary red
  "#FF6B7A",
  "#C92F44",
  "#FF8493",
  "#A8232F",
];

// ─── Helpers ──────────────────────────────────────────────────────────

function formatMinSec(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = Math.floor(seconds % 60);
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

// ─── Component ────────────────────────────────────────────────────────

export function KDAChart({
  gameNumber,
  durationSeconds,
  players,
  kills,
}: KDAChartProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [reducedMotion, setReducedMotion] = useState(false);

  // Track container width — no SSR layout shift since we always render
  // with a 640 px fallback, then update once mounted.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth || 640);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // ─── Build per-player kill series ─────────────────────────────────
  //
  // For each player, walk the kills feed and accumulate. We match by
  // killer_champion (the kill row's champion) because killer_player_id
  // is not always populated on historical rows. For the assists case
  // we'd need the JSONB column — skipped for now (see file header).
  const series = useMemo(() => {
    const byChampion = new Map<string, KDAChartPlayer>();
    for (const p of players) byChampion.set(p.champion, p);

    type Point = { t: number; v: number };
    const points = new Map<string, Point[]>();
    const counts = new Map<string, number>();
    for (const p of players) {
      points.set(p.champion, [{ t: 0, v: 0 }]);
      counts.set(p.champion, 0);
    }

    const sorted = [...kills].sort(
      (a, b) => (a.game_time_seconds ?? 0) - (b.game_time_seconds ?? 0),
    );
    for (const k of sorted) {
      const champion = k.killer_champion;
      if (!champion) continue;
      const player = byChampion.get(champion);
      if (!player) continue;
      const prev = counts.get(champion) ?? 0;
      const next = prev + 1;
      counts.set(champion, next);
      const t = k.game_time_seconds ?? 0;
      const arr = points.get(champion) ?? [];
      arr.push({ t, v: next });
      points.set(champion, arr);
    }

    // Cap the final point to the game duration (or the latest kill's
    // time when duration is unknown).
    const lastTime = Math.max(
      durationSeconds ?? 0,
      ...sorted.map((k) => k.game_time_seconds ?? 0),
    );
    for (const [champion, arr] of points) {
      const final = arr[arr.length - 1];
      if (final && final.t < lastTime) {
        arr.push({ t: lastTime, v: final.v });
      }
    }
    return { points, lastTime };
  }, [players, kills, durationSeconds]);

  const maxValue = useMemo(() => {
    let max = 0;
    for (const arr of series.points.values()) {
      for (const p of arr) if (p.v > max) max = p.v;
    }
    // Always reserve at least 5 on the Y axis so a low-action game
    // doesn't get a single tick at 1.
    return Math.max(5, max);
  }, [series]);

  // Layout constants ───────────────────────────────────────────────────
  const height = 220;
  const margin = { top: 18, right: 20, bottom: 28, left: 36 };
  const innerW = Math.max(60, width - margin.left - margin.right);
  const innerH = height - margin.top - margin.bottom;

  const xScale = (t: number) =>
    series.lastTime > 0 ? (t / series.lastTime) * innerW : 0;
  const yScale = (v: number) => innerH - (v / maxValue) * innerH;

  // ─── X axis ticks every 5 / 10 min ─────────────────────────────────
  const tickInterval =
    series.lastTime <= 25 * 60 ? 5 : series.lastTime <= 40 * 60 ? 10 : 15;
  const xTicks: number[] = [];
  for (let m = 0; m * 60 <= series.lastTime; m += tickInterval) {
    xTicks.push(m * 60);
  }

  // ─── Y axis ticks every 2 if max ≤ 10 else every 5 ─────────────────
  const yStep = maxValue <= 10 ? 2 : 5;
  const yTicks: number[] = [];
  for (let v = 0; v <= maxValue; v += yStep) yTicks.push(v);

  // ─── Series colors ─────────────────────────────────────────────────
  function colorFor(player: KDAChartPlayer, idx: number): string {
    const palette = player.side === "kc" ? KC_PALETTE : OPP_PALETTE;
    return palette[idx % palette.length];
  }

  // ─── SVG paths ─────────────────────────────────────────────────────
  function pathFor(player: KDAChartPlayer): string {
    const arr = series.points.get(player.champion) ?? [];
    if (arr.length === 0) return "";
    // Step-after line (kills are atomic events) — use horizontal-then-
    // vertical segments so the line "stairs" up rather than diagonals
    // that misrepresent when the kill actually happened.
    const seg: string[] = [];
    arr.forEach((p, i) => {
      const x = xScale(p.t);
      const y = yScale(p.v);
      if (i === 0) {
        seg.push(`M ${x.toFixed(1)} ${y.toFixed(1)}`);
      } else {
        const prev = arr[i - 1];
        const prevY = yScale(prev.v);
        // Stair-step : draw horizontal to the new X first, then jump Y.
        seg.push(`L ${x.toFixed(1)} ${prevY.toFixed(1)}`);
        seg.push(`L ${x.toFixed(1)} ${y.toFixed(1)}`);
      }
    });
    return seg.join(" ");
  }

  // Each series gets a key for the legend toggle.
  function toggle(champion: string) {
    setHidden((cur) => {
      const next = new Set(cur);
      if (next.has(champion)) next.delete(champion);
      else next.add(champion);
      return next;
    });
  }

  const kcPlayers = players.filter((p) => p.side === "kc");
  const oppPlayers = players.filter((p) => p.side === "opp");

  return (
    <figure
      ref={wrapRef}
      className="space-y-3"
      role="figure"
      aria-label={`Évolution des kills par joueur — Game ${gameNumber}`}
    >
      <div className="overflow-x-auto">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          aria-hidden
          className="block"
        >
          {/* Background grid — Y ticks */}
          <g transform={`translate(${margin.left} ${margin.top})`}>
            {yTicks.map((v) => {
              const y = yScale(v);
              return (
                <g key={`y-${v}`}>
                  <line
                    x1={0}
                    x2={innerW}
                    y1={y}
                    y2={y}
                    stroke="rgba(200,170,110,0.08)"
                    strokeDasharray="2 3"
                  />
                  <text
                    x={-8}
                    y={y + 3}
                    textAnchor="end"
                    fill="rgba(123,141,181,0.7)"
                    fontSize="9"
                    fontFamily="var(--font-jetbrains-mono), monospace"
                  >
                    {v}
                  </text>
                </g>
              );
            })}

            {/* X axis tick labels */}
            {xTicks.map((t) => {
              const x = xScale(t);
              return (
                <g key={`x-${t}`}>
                  <line
                    x1={x}
                    x2={x}
                    y1={0}
                    y2={innerH}
                    stroke="rgba(200,170,110,0.04)"
                  />
                  <text
                    x={x}
                    y={innerH + 14}
                    textAnchor="middle"
                    fill="rgba(123,141,181,0.7)"
                    fontSize="9"
                    fontFamily="var(--font-jetbrains-mono), monospace"
                  >
                    {Math.floor(t / 60)}'
                  </text>
                </g>
              );
            })}

            {/* Axis lines */}
            <line
              x1={0}
              x2={innerW}
              y1={innerH}
              y2={innerH}
              stroke="rgba(200,170,110,0.3)"
            />
            <line
              x1={0}
              x2={0}
              y1={0}
              y2={innerH}
              stroke="rgba(200,170,110,0.3)"
            />

            {/* Series */}
            {players.map((player, idxAll) => {
              const isKc = player.side === "kc";
              const idx = isKc
                ? kcPlayers.findIndex((p) => p.champion === player.champion)
                : oppPlayers.findIndex((p) => p.champion === player.champion);
              const color = colorFor(player, idx);
              const path = pathFor(player);
              const visible = !hidden.has(player.champion);
              if (!path) return null;
              return (
                <g key={`${player.champion}-${idxAll}`}>
                  <path
                    d={path}
                    fill="none"
                    stroke={color}
                    strokeWidth={isKc ? 1.8 : 1.4}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={visible ? 0.92 : 0.08}
                    style={
                      reducedMotion
                        ? undefined
                        : {
                            strokeDasharray: 600,
                            strokeDashoffset: 600,
                            animation:
                              "kda-draw 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards",
                          }
                    }
                  />
                  {/* End-point dot */}
                  {(() => {
                    const arr = series.points.get(player.champion) ?? [];
                    const last = arr[arr.length - 1];
                    if (!last) return null;
                    return (
                      <circle
                        cx={xScale(last.t)}
                        cy={yScale(last.v)}
                        r={isKc ? 3 : 2.4}
                        fill={color}
                        opacity={visible ? 0.95 : 0.15}
                      />
                    );
                  })()}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      {/* Legend — keyboard toggleable */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {players.map((player) => {
          const isKc = player.side === "kc";
          const idx = isKc
            ? kcPlayers.findIndex((p) => p.champion === player.champion)
            : oppPlayers.findIndex((p) => p.champion === player.champion);
          const color = colorFor(player, idx);
          const visible = !hidden.has(player.champion);
          return (
            <button
              key={`legend-${player.champion}`}
              type="button"
              onClick={() => toggle(player.champion)}
              aria-pressed={visible}
              className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-[10px] uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${
                visible
                  ? "border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--text-primary)]"
                  : "border-[var(--border-subtle)] bg-[var(--bg-primary)] text-[var(--text-disabled)]"
              }`}
            >
              <span
                aria-hidden
                className="block h-2 w-2 rounded-full"
                style={{
                  backgroundColor: color,
                  opacity: visible ? 1 : 0.25,
                }}
              />
              <span className="flex-1 truncate font-data">
                {player.ign}
              </span>
              {player.kdaLabel && (
                <span className="font-data text-[9px] text-[var(--text-muted)]">
                  {player.kdaLabel}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <style>{`
        @keyframes kda-draw {
          to { stroke-dashoffset: 0; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-kda-line] { animation: none !important; stroke-dashoffset: 0 !important; }
        }
      `}</style>

      {/* Screen-reader table fallback. */}
      <figcaption className="sr-only">
        Tableau des kills cumulés par joueur pour la Game {gameNumber} ;
        durée {formatMinSec(series.lastTime)}.
      </figcaption>
      <table className="sr-only">
        <thead>
          <tr>
            <th scope="col">Joueur</th>
            <th scope="col">Champion</th>
            <th scope="col">Camp</th>
            <th scope="col">Kills finaux</th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const arr = series.points.get(p.champion) ?? [];
            const final = arr[arr.length - 1]?.v ?? 0;
            return (
              <tr key={`sr-row-${p.champion}`}>
                <td>{p.ign}</td>
                <td>{p.champion}</td>
                <td>{p.side === "kc" ? "KC" : "Adversaire"}</td>
                <td>{final}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </figure>
  );
}
