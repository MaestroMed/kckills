"use client";

/**
 * EraComparison — bespoke SVG charts for the per-era KC stats panel.
 * Wave 13e revamp (2026-04-29) — was the last recharts holdout in the
 * codebase. Hand-rolled to match the same Hextech aesthetic + GPU-
 * composited animations as PlayerCharts.tsx + TaggingInsights.tsx.
 *
 * Saves ~100 KB on the homepage path (recharts dependency dropped
 * entirely from the route's module graph).
 *
 * Two charts :
 *   * <WinrateAreaChart>  — area chart with green gradient fill
 *   * <KillsLineChart>    — dual-line (KC vs adversaire) per era
 *
 * Both :
 *   * SSR-safe markup, mobile-first sizing
 *   * Hover ring on each data point reveals exact value
 *   * `prefers-reduced-motion` honoured via globals.css `.pc-bar`
 *     keyframes (re-using the player-chart anims so we don't ship
 *     dupe CSS)
 *   * Container-query responsive (parent width drives layout)
 */

import { useMemo } from "react";

interface EraStats {
  era: string;
  period: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKcKills: number;
  avgOppKills: number;
}

const GOLD = "#C8AA6E";
const GOLD_BRIGHT = "#F0E6D2";
const RED = "#E84057";
const GREEN = "#00C853";

// ─── Shared geometry helpers ─────────────────────────────────────────

interface ChartGeometry {
  width: number;
  height: number;
  padX: number;
  padTop: number;
  padBottom: number;
}

const GEOM: ChartGeometry = {
  width: 600,
  height: 200,
  padX: 36,
  padTop: 18,
  padBottom: 30,
};

function plotArea(g: ChartGeometry) {
  return {
    x0: g.padX,
    x1: g.width - g.padX,
    y0: g.padTop,
    y1: g.height - g.padBottom,
    plotW: g.width - 2 * g.padX,
    plotH: g.height - g.padTop - g.padBottom,
  };
}

function xForIndex(idx: number, total: number, area: ReturnType<typeof plotArea>) {
  if (total <= 1) return area.x0 + area.plotW / 2;
  return area.x0 + (idx / (total - 1)) * area.plotW;
}

function yForValue(
  value: number,
  min: number,
  max: number,
  area: ReturnType<typeof plotArea>,
) {
  const range = max - min || 1;
  const norm = (value - min) / range;
  return area.y1 - norm * area.plotH;
}

// ─── Public component ────────────────────────────────────────────────

export function EraComparisonChart({ data }: { data: EraStats[] }) {
  if (data.length < 2) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
        <h3 className="font-display text-sm font-bold text-[var(--text-secondary)] mb-4">
          Winrate par &egrave;re
        </h3>
        <WinrateAreaChart data={data} />
      </div>

      <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
        <h3 className="font-display text-sm font-bold text-[var(--text-secondary)] mb-4">
          Kills/game par &egrave;re
        </h3>
        <KillsLineChart data={data} />
      </div>
    </div>
  );
}

// ─── Winrate area chart ──────────────────────────────────────────────

function WinrateAreaChart({ data }: { data: EraStats[] }) {
  const area = plotArea(GEOM);
  const uid = "era-winrate";

  // Y axis fixed at 0..100 (winrate is a percentage)
  const min = 0;
  const max = 100;

  // Build the area path — line across data points + close to baseline
  const { areaPath, linePath, points } = useMemo(() => {
    const pts = data.map((d, i) => ({
      x: xForIndex(i, data.length, area),
      y: yForValue(d.winRate, min, max, area),
      label: d.period,
      value: d.winRate,
    }));
    const line =
      pts
        .map(
          (p, i) =>
            `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`,
        )
        .join(" ");
    const areaP =
      `${line} L${pts[pts.length - 1].x.toFixed(1)},${area.y1} ` +
      `L${pts[0].x.toFixed(1)},${area.y1} Z`;
    return { areaPath: areaP, linePath: line, points: pts };
  }, [data, area]);

  // Y axis ticks every 25%
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <div className="w-full pc-radar transform-gpu">
      <svg
        viewBox={`0 0 ${GEOM.width} ${GEOM.height}`}
        className="w-full h-auto overflow-visible"
        preserveAspectRatio="none"
        role="img"
        aria-label="Winrate par ère KC"
      >
        <defs>
          <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={GREEN} stopOpacity="0.45" />
            <stop offset="100%" stopColor={GREEN} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Y grid lines + labels */}
        {yTicks.map((v) => {
          const y = yForValue(v, min, max, area);
          return (
            <g key={`y-${v}`}>
              <line
                x1={area.x0}
                x2={area.x1}
                y1={y}
                y2={y}
                stroke="rgba(200,170,110,0.08)"
                strokeWidth={0.6}
                strokeDasharray="3 3"
              />
              <text
                x={area.x0 - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#5B6A8A"
                fontFamily="Space Mono, monospace"
                fontSize="9"
              >
                {v}%
              </text>
            </g>
          );
        })}

        {/* Area fill + line */}
        <path d={areaPath} fill={`url(#${uid}-fill)`} />
        <path
          d={linePath}
          fill="none"
          stroke={GREEN}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Data points + hover halos */}
        {points.map((p, i) => (
          <g key={`pt-${i}`} className="group">
            {/* Invisible fat target for hover */}
            <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
            {/* Visible glow on hover */}
            <circle
              cx={p.x}
              cy={p.y}
              r={6}
              fill={GREEN}
              fillOpacity="0.3"
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
            {/* Solid dot */}
            <circle cx={p.x} cy={p.y} r={3} fill={GREEN} />
            {/* Tooltip on hover */}
            <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <rect
                x={p.x - 24}
                y={p.y - 28}
                width={48}
                height={20}
                rx={4}
                fill="rgba(10,20,40,0.95)"
                stroke={GREEN}
                strokeOpacity="0.4"
                strokeWidth={1}
              />
              <text
                x={p.x}
                y={p.y - 14}
                textAnchor="middle"
                fill={GOLD_BRIGHT}
                fontFamily="Space Mono, monospace"
                fontSize="10"
                fontWeight="700"
              >
                {p.value.toFixed(0)}%
              </text>
            </g>
          </g>
        ))}

        {/* X axis labels */}
        {points.map((p, i) => (
          <text
            key={`xlabel-${i}`}
            x={p.x}
            y={GEOM.height - 8}
            textAnchor="middle"
            fill="#A09B8C"
            fontFamily="Space Mono, monospace"
            fontSize="9"
          >
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}

// ─── Kills line chart (dual-line KC vs adversaire) ───────────────────

function KillsLineChart({ data }: { data: EraStats[] }) {
  const area = plotArea(GEOM);
  const uid = "era-kills";

  // Y range : auto-fit min/max of both series with 10% padding
  const { min, max, kcPts, oppPts } = useMemo(() => {
    const allValues = data.flatMap((d) => [d.avgKcKills, d.avgOppKills]);
    const rawMin = Math.min(...allValues);
    const rawMax = Math.max(...allValues);
    const pad = (rawMax - rawMin) * 0.1 || 1;
    const minV = Math.max(0, Math.floor(rawMin - pad));
    const maxV = Math.ceil(rawMax + pad);

    const kc = data.map((d, i) => ({
      x: xForIndex(i, data.length, area),
      y: yForValue(d.avgKcKills, minV, maxV, area),
      label: d.period,
      value: d.avgKcKills,
    }));
    const opp = data.map((d, i) => ({
      x: xForIndex(i, data.length, area),
      y: yForValue(d.avgOppKills, minV, maxV, area),
      label: d.period,
      value: d.avgOppKills,
    }));
    return { min: minV, max: maxV, kcPts: kc, oppPts: opp };
  }, [data, area]);

  const kcLine = kcPts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");
  const oppLine = oppPts
    .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  // Y axis : 5 ticks evenly spaced
  const yTicks = useMemo(() => {
    const step = (max - min) / 4;
    return Array.from({ length: 5 }, (_, i) => min + i * step);
  }, [min, max]);

  return (
    <div className="w-full pc-radar transform-gpu">
      {/* Legend */}
      <div className="flex items-center justify-end gap-4 mb-2 px-1 text-[10px] uppercase tracking-[0.18em]">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded-full"
            style={{ background: GOLD }}
          />
          <span style={{ color: GOLD }}>KC kills</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 rounded-full border-t border-dashed"
            style={{ borderColor: RED, background: RED }}
          />
          <span style={{ color: RED }}>Adversaire</span>
        </span>
      </div>

      <svg
        viewBox={`0 0 ${GEOM.width} ${GEOM.height}`}
        className="w-full h-auto overflow-visible"
        preserveAspectRatio="none"
        role="img"
        aria-label="Kills par game par ère — KC vs adversaires"
      >
        {/* Y grid lines + labels */}
        {yTicks.map((v) => {
          const y = yForValue(v, min, max, area);
          return (
            <g key={`y-${uid}-${v}`}>
              <line
                x1={area.x0}
                x2={area.x1}
                y1={y}
                y2={y}
                stroke="rgba(200,170,110,0.08)"
                strokeWidth={0.6}
                strokeDasharray="3 3"
              />
              <text
                x={area.x0 - 8}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                fill="#5B6A8A"
                fontFamily="Space Mono, monospace"
                fontSize="9"
              >
                {v.toFixed(0)}
              </text>
            </g>
          );
        })}

        {/* Adversaire line (dashed red) — drawn first so KC overlays */}
        <path
          d={oppLine}
          fill="none"
          stroke={RED}
          strokeWidth={1.8}
          strokeDasharray="4 4"
          strokeLinejoin="round"
          strokeLinecap="round"
          opacity="0.85"
        />

        {/* KC line (solid gold) */}
        <path
          d={kcLine}
          fill="none"
          stroke={GOLD}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Adversaire dots */}
        {oppPts.map((p, i) => (
          <g key={`opp-${i}`} className="group">
            <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
            <circle
              cx={p.x}
              cy={p.y}
              r={6}
              fill={RED}
              fillOpacity="0.3"
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
            <circle
              cx={p.x}
              cy={p.y}
              r={3}
              fill={RED}
              fillOpacity="0.85"
            />
            <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <rect
                x={p.x - 24}
                y={p.y + 8}
                width={48}
                height={18}
                rx={4}
                fill="rgba(10,20,40,0.95)"
                stroke={RED}
                strokeOpacity="0.4"
                strokeWidth={1}
              />
              <text
                x={p.x}
                y={p.y + 21}
                textAnchor="middle"
                fill={GOLD_BRIGHT}
                fontFamily="Space Mono, monospace"
                fontSize="10"
                fontWeight="700"
              >
                {p.value.toFixed(1)}
              </text>
            </g>
          </g>
        ))}

        {/* KC dots */}
        {kcPts.map((p, i) => (
          <g key={`kc-${i}`} className="group">
            <circle cx={p.x} cy={p.y} r={14} fill="transparent" />
            <circle
              cx={p.x}
              cy={p.y}
              r={7}
              fill={GOLD}
              fillOpacity="0.35"
              className="opacity-0 group-hover:opacity-100 transition-opacity"
            />
            <circle cx={p.x} cy={p.y} r={3.5} fill={GOLD} />
            <g className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
              <rect
                x={p.x - 24}
                y={p.y - 28}
                width={48}
                height={20}
                rx={4}
                fill="rgba(10,20,40,0.95)"
                stroke={GOLD}
                strokeOpacity="0.5"
                strokeWidth={1}
              />
              <text
                x={p.x}
                y={p.y - 14}
                textAnchor="middle"
                fill={GOLD_BRIGHT}
                fontFamily="Space Mono, monospace"
                fontSize="10"
                fontWeight="700"
              >
                {p.value.toFixed(1)}
              </text>
            </g>
          </g>
        ))}

        {/* X axis labels */}
        {kcPts.map((p, i) => (
          <text
            key={`xlabel-${uid}-${i}`}
            x={p.x}
            y={GEOM.height - 8}
            textAnchor="middle"
            fill="#A09B8C"
            fontFamily="Space Mono, monospace"
            fontSize="9"
          >
            {p.label}
          </text>
        ))}
      </svg>
    </div>
  );
}
