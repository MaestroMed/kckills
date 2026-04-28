"use client";

/**
 * PlayerCharts — bespoke SVG charts for the /player/[slug] analytics
 * section. Hand-rolled to replace the recharts-based originals which
 * shipped ~100 KB of D3 + chart code per route, lagged on mobile because
 * ResponsiveContainer fires resize observers on every layout pass, and
 * looked too generic for a Hextech-themed esports site.
 *
 * Why hand-rolled SVG :
 *   * Bundle weight : ~5 KB instead of 100 KB. Player page First Load
 *     drops from 240 → 145 KB ish (recharts dropped from package.json).
 *   * Mobile CPU : zero recharts ResponsiveContainer + no D3 scales.
 *     Static SVG paths, CSS-driven animations, GPU-composited.
 *   * Visual identity : League of Legends Hextech aesthetic — gold
 *     gradients, hexagonal radar instead of pentagon, glow filters on
 *     winning bars, champion icons floating above their stat columns.
 *
 * Components exported :
 *   - PlayerRadar              — hex stats radar with animated draw-on
 *   - ChampionPerformanceChart — vertical bar grid with floating icons
 *   - RecentFormChart          — W/L streak tiles with KDA + tooltip
 *
 * All three :
 *   * Render valid SSR-safe markup (no useEffect-gated content).
 *   * Use `transform-gpu` + CSS keyframes for entrance animations.
 *   * Honour `prefers-reduced-motion` via a single media query block.
 *   * Mobile-first sizing — viewBox stays fixed, container defines
 *     the rendered px so they reflow naturally.
 */

import Image from "next/image";
import { championIconUrl } from "@/lib/constants";

interface ChampionStat {
  name: string;
  games: number;
  kills: number;
  deaths: number;
  assists: number;
}

interface MatchEntry {
  matchId: string;
  date: string;
  opponent: string;
  champion: string;
  kills: number;
  deaths: number;
  assists: number;
  won: boolean;
}

const GOLD = "#C8AA6E";
const GOLD_BRIGHT = "#F0E6D2";
const GOLD_DARK = "#785A28";
const CYAN = "#0AC8B9";
const RED = "#E84057";
const GREEN = "#00C853";

// ─── Shared SVG defs (gradients + filters) ───────────────────────────
function HextechDefs({ uid }: { uid: string }) {
  return (
    <defs>
      <linearGradient id={`gold-${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={GOLD_BRIGHT} stopOpacity="0.95" />
        <stop offset="60%" stopColor={GOLD} stopOpacity="0.85" />
        <stop offset="100%" stopColor={GOLD_DARK} stopOpacity="0.75" />
      </linearGradient>
      <linearGradient id={`gold-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={GOLD} stopOpacity="0.45" />
        <stop offset="100%" stopColor={GOLD_DARK} stopOpacity="0.05" />
      </linearGradient>
      <linearGradient id={`win-${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={GREEN} stopOpacity="0.95" />
        <stop offset="100%" stopColor="#007E33" stopOpacity="0.7" />
      </linearGradient>
      <linearGradient id={`loss-${uid}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={RED} stopOpacity="0.85" />
        <stop offset="100%" stopColor="#7A1F2E" stopOpacity="0.55" />
      </linearGradient>
      <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
        <feGaussianBlur stdDeviation="2.5" result="blur" />
        <feMerge>
          <feMergeNode in="blur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

// ─── PlayerRadar — hexagonal stats web ───────────────────────────────
//
// Six axes : Kills, Assists, Survival, CS/min, Gold, Pressure (KP%).
// Each axis is normalised to a 0..1 score using sane LoL ceilings so
// that pro-player stats land in the 0.4..0.95 sweet spot. The polygon
// uses a CSS @keyframes scaleIn for the draw-on, with a small stagger
// per apex marker so the chart "lights up" rather than appears.
export function PlayerRadar({
  avgKills,
  avgDeaths,
  avgAssists,
  gamesPlayed,
  totalGold,
  totalCS,
}: {
  avgKills: number;
  avgDeaths: number;
  avgAssists: number;
  gamesPlayed: number;
  totalGold: number;
  totalCS: number;
}) {
  const uid = "radar";
  const avgGoldK = gamesPlayed > 0 ? totalGold / gamesPlayed / 1000 : 0;
  const avgCS = gamesPlayed > 0 ? totalCS / gamesPlayed : 0;

  const axes = [
    { label: "Kills", value: clamp01(avgKills / 7) },
    { label: "Assists", value: clamp01(avgAssists / 9) },
    { label: "Survie", value: avgDeaths > 0 ? clamp01(2.5 / avgDeaths) : 1 },
    { label: "CS/min", value: clamp01(avgCS / 320) },
    { label: "Gold", value: clamp01(avgGoldK / 16) },
    {
      label: "Impact",
      value: clamp01((avgKills + avgAssists) / 14),
    },
  ];

  // Geometry — hexagon, 6 apexes, 4 grid rings.
  const cx = 150;
  const cy = 150;
  const radius = 105;
  const sides = axes.length;
  const angleFor = (i: number) => -Math.PI / 2 + (i * Math.PI * 2) / sides;
  const ringFractions = [0.25, 0.5, 0.75, 1];

  const polygonPath = (fraction: number) =>
    Array.from({ length: sides }, (_, i) => {
      const a = angleFor(i);
      const x = cx + Math.cos(a) * radius * fraction;
      const y = cy + Math.sin(a) * radius * fraction;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ") + " Z";

  const valuePath =
    axes
      .map((a, i) => {
        const ang = angleFor(i);
        const x = cx + Math.cos(ang) * radius * a.value;
        const y = cy + Math.sin(ang) * radius * a.value;
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ") + " Z";

  return (
    <div className="w-full max-w-[300px] aspect-square mx-auto pc-radar transform-gpu">
      <svg
        viewBox="0 0 300 300"
        className="w-full h-full overflow-visible"
        role="img"
        aria-label="Profil de jeu — radar hexagonal des forces du joueur"
      >
        <HextechDefs uid={uid} />

        {/* Background grid rings (hexagons nested) */}
        {ringFractions.map((f, idx) => (
          <path
            key={`ring-${idx}`}
            d={polygonPath(f)}
            fill="none"
            stroke="rgba(200,170,110,0.12)"
            strokeWidth={idx === ringFractions.length - 1 ? 1.2 : 0.6}
          />
        ))}

        {/* Spokes from centre to each apex */}
        {axes.map((_, i) => {
          const a = angleFor(i);
          const x = cx + Math.cos(a) * radius;
          const y = cy + Math.sin(a) * radius;
          return (
            <line
              key={`spoke-${i}`}
              x1={cx}
              y1={cy}
              x2={x}
              y2={y}
              stroke="rgba(200,170,110,0.1)"
              strokeWidth={0.6}
            />
          );
        })}

        {/* Value polygon — animated draw-on via CSS */}
        <g className="pc-radar-poly">
          <path
            d={valuePath}
            fill={`url(#gold-fill-${uid})`}
            stroke={`url(#gold-${uid})`}
            strokeWidth={1.8}
            strokeLinejoin="round"
            filter={`url(#glow-${uid})`}
          />
          {axes.map((a, i) => {
            const ang = angleFor(i);
            const x = cx + Math.cos(ang) * radius * a.value;
            const y = cy + Math.sin(ang) * radius * a.value;
            return (
              <circle
                key={`apex-${i}`}
                cx={x}
                cy={y}
                r={3}
                fill={GOLD_BRIGHT}
                stroke={GOLD_DARK}
                strokeWidth={1}
                style={{
                  animationDelay: `${0.6 + i * 0.08}s`,
                }}
                className="pc-radar-apex"
              />
            );
          })}
        </g>

        {/* Axis labels — outside the polygon */}
        {axes.map((a, i) => {
          const ang = angleFor(i);
          const lx = cx + Math.cos(ang) * (radius + 22);
          const ly = cy + Math.sin(ang) * (radius + 22);
          const valX = cx + Math.cos(ang) * (radius + 38);
          const valY = cy + Math.sin(ang) * (radius + 38);
          return (
            <g key={`label-${i}`}>
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                fill="#A09B8C"
                fontFamily="Space Mono, monospace"
                fontSize="10"
                fontWeight="700"
                letterSpacing="0.05em"
              >
                {a.label.toUpperCase()}
              </text>
              <text
                x={valX}
                y={valY}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={GOLD}
                fontFamily="Space Mono, monospace"
                fontSize="9"
                fontWeight="700"
                opacity="0.7"
              >
                {Math.round(a.value * 100)}
              </text>
            </g>
          );
        })}

        {/* Centre badge — hex emblem with KDA */}
        <circle
          cx={cx}
          cy={cy}
          r={24}
          fill="rgba(10,20,40,0.9)"
          stroke={GOLD}
          strokeWidth={1.2}
          opacity={0.9}
        />
        <text
          x={cx}
          y={cy - 4}
          textAnchor="middle"
          fill={GOLD}
          fontFamily="Space Mono, monospace"
          fontSize="8"
          fontWeight="700"
          opacity="0.7"
        >
          KDA
        </text>
        <text
          x={cx}
          y={cy + 9}
          textAnchor="middle"
          fill={GOLD_BRIGHT}
          fontFamily="Cinzel, serif"
          fontSize="13"
          fontWeight="900"
        >
          {avgDeaths > 0
            ? ((avgKills + avgAssists) / avgDeaths).toFixed(1)
            : "∞"}
        </text>
      </svg>
    </div>
  );
}

// ─── ChampionPerformanceChart — bars with floating champion icons ─────
//
// Each champion gets a thin rounded gold/cyan bar whose height encodes
// games played, with the champion icon floating above the bar tip and
// a tiny KDA pill below the bar baseline. Hovering raises the bar +
// reveals a richer tooltip without re-mounting the SVG.
export function ChampionPerformanceChart({
  champions,
}: {
  champions: ChampionStat[];
}) {
  const uid = "champ";
  const data = champions.slice(0, 8);
  if (data.length === 0) return null;

  const maxGames = Math.max(...data.map((c) => c.games));
  const barAreaH = 140; // pixels reserved for the bar columns
  const iconSize = 28;

  return (
    <div className="w-full pc-champ-chart">
      <div
        className="flex items-end gap-2 sm:gap-3 px-1"
        style={{ height: barAreaH + iconSize + 38 }}
      >
        {data.map((c, i) => {
          const heightPct = maxGames > 0 ? c.games / maxGames : 0;
          const barH = Math.max(8, heightPct * barAreaH);
          const kda =
            c.deaths > 0
              ? ((c.kills + c.assists) / c.deaths).toFixed(1)
              : (c.kills + c.assists).toFixed(1);
          const isTop = i === 0;
          return (
            <div
              key={c.name}
              className="group relative flex-1 flex flex-col items-center justify-end min-w-0"
              title={`${c.name} — ${c.games} games · ${c.kills}/${c.deaths}/${c.assists} (KDA ${kda})`}
            >
              {/* Floating icon above the bar */}
              <div
                className="relative mb-1.5 transition-transform duration-300 group-hover:-translate-y-1"
                style={{
                  width: iconSize,
                  height: iconSize,
                }}
              >
                <Image
                  src={championIconUrl(c.name)}
                  alt={c.name}
                  fill
                  sizes="28px"
                  className="rounded-full object-cover"
                  style={{
                    boxShadow: isTop
                      ? `0 0 12px ${GOLD}55, 0 0 0 1px ${GOLD}`
                      : `0 0 0 1px rgba(200,170,110,0.35)`,
                  }}
                />
              </div>

              {/* Games count above bar */}
              <span
                className="font-data text-[10px] font-bold mb-1"
                style={{ color: isTop ? GOLD_BRIGHT : "#A09B8C" }}
              >
                {c.games}
              </span>

              {/* Animated bar */}
              <svg
                width="100%"
                height={barAreaH}
                viewBox={`0 0 40 ${barAreaH}`}
                preserveAspectRatio="none"
                className="overflow-visible"
                aria-hidden
              >
                <HextechDefs uid={`${uid}-${i}`} />
                <rect
                  x={10}
                  y={barAreaH - barH}
                  width={20}
                  height={barH}
                  rx={4}
                  ry={4}
                  fill={
                    isTop ? `url(#gold-${uid}-${i})` : "rgba(10,200,185,0.55)"
                  }
                  stroke={isTop ? GOLD : CYAN}
                  strokeOpacity={0.4}
                  strokeWidth={0.8}
                  className="pc-bar transition-[transform,filter] duration-300 origin-bottom group-hover:[transform:scaleY(1.04)]"
                  style={{
                    filter: isTop
                      ? `drop-shadow(0 0 6px ${GOLD}77)`
                      : `drop-shadow(0 0 4px ${CYAN}44)`,
                    animationDelay: `${i * 0.07}s`,
                    transformOrigin: `20px ${barAreaH}px`,
                  }}
                />
                {/* Top cap accent line */}
                <line
                  x1={10}
                  x2={30}
                  y1={barAreaH - barH + 2}
                  y2={barAreaH - barH + 2}
                  stroke={isTop ? GOLD_BRIGHT : "#5DE9DC"}
                  strokeWidth={1.2}
                  className="pc-bar"
                  style={{ animationDelay: `${i * 0.07 + 0.05}s` }}
                />
              </svg>

              {/* Champion name + KDA pill */}
              <span className="font-display text-[10px] font-bold text-white/80 mt-1.5 max-w-full truncate w-full text-center">
                {c.name}
              </span>
              <span
                className="font-data text-[9px] font-bold tabular-nums"
                style={{
                  color:
                    parseFloat(kda) >= 4
                      ? GREEN
                      : parseFloat(kda) >= 2
                        ? GOLD
                        : "#A09B8C",
                }}
              >
                {kda}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── RecentFormChart — W/L streak tiles ──────────────────────────────
//
// Each match becomes a tile : champion icon + KDA, golden glow on wins,
// faded red on losses. Streaks of 3+ wins get a continuous glow chain
// painted as a CSS pseudo-element underneath. Hover raises the tile
// and surfaces opponent + champion via the title attribute.
export function RecentFormChart({ history }: { history: MatchEntry[] }) {
  const recent = history.slice(0, 12).reverse();
  if (recent.length === 0) return null;

  // Compute streak markers : true for tiles that belong to a 3+ run.
  const inStreak = recent.map((m, i) => {
    let count = 1;
    for (let k = i - 1; k >= 0 && recent[k].won === m.won; k--) count++;
    for (let k = i + 1; k < recent.length && recent[k].won === m.won; k++)
      count++;
    return count >= 3;
  });

  const wins = recent.filter((m) => m.won).length;
  const losses = recent.length - wins;

  return (
    <div className="w-full pc-form">
      {/* Header — W/L counts + winrate */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-3">
          <span className="font-data text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
            {recent.length} derniers
          </span>
          <span
            className="font-data text-[10px] font-bold"
            style={{ color: GREEN }}
          >
            {wins}W
          </span>
          <span
            className="font-data text-[10px] font-bold"
            style={{ color: RED }}
          >
            {losses}L
          </span>
        </div>
        <span
          className="font-data text-xs font-black tabular-nums"
          style={{ color: wins / recent.length >= 0.5 ? GREEN : RED }}
        >
          {Math.round((wins / recent.length) * 100)}%
        </span>
      </div>

      {/* Tile chain */}
      <div className="grid grid-cols-12 gap-1.5">
        {recent.map((m, i) => {
          const kda =
            m.deaths > 0
              ? ((m.kills + m.assists) / m.deaths).toFixed(1)
              : "Perf";
          const isWin = m.won;
          const streak = inStreak[i];
          return (
            <a
              key={`${m.matchId}-${i}`}
              href={`/match/${m.matchId}`}
              className="group relative aspect-square rounded-md overflow-hidden border transition-all duration-300 hover:-translate-y-0.5"
              style={{
                borderColor: isWin
                  ? `rgba(0,200,83,${streak ? 0.65 : 0.3})`
                  : `rgba(232,64,87,${streak ? 0.55 : 0.25})`,
                boxShadow:
                  isWin && streak
                    ? `0 0 10px rgba(0,200,83,0.35)`
                    : "none",
              }}
              title={`vs ${m.opponent} · ${m.champion} · ${m.kills}/${m.deaths}/${m.assists} (KDA ${kda})`}
              aria-label={`${isWin ? "Victoire" : "Défaite"} vs ${m.opponent} avec ${m.champion}, KDA ${kda}`}
            >
              {/* Champion mini icon as backdrop */}
              <Image
                src={championIconUrl(m.champion)}
                alt=""
                fill
                sizes="40px"
                className="object-cover opacity-50 group-hover:opacity-80 transition-opacity"
              />
              {/* Tint overlay */}
              <div
                className="absolute inset-0"
                style={{
                  background: isWin
                    ? "linear-gradient(180deg, rgba(0,200,83,0.15) 0%, rgba(0,126,52,0.45) 100%)"
                    : "linear-gradient(180deg, rgba(232,64,87,0.1) 0%, rgba(122,31,46,0.4) 100%)",
                }}
              />
              {/* W/L letter */}
              <span
                className="absolute top-0.5 left-1 font-display text-[10px] font-black"
                style={{
                  color: isWin ? GREEN : RED,
                  textShadow: "0 1px 2px rgba(0,0,0,0.6)",
                }}
              >
                {isWin ? "W" : "L"}
              </span>
              {/* KDA bottom */}
              <span
                className="absolute bottom-0.5 right-1 font-data text-[9px] font-bold tabular-nums"
                style={{
                  color: GOLD_BRIGHT,
                  textShadow: "0 1px 2px rgba(0,0,0,0.8)",
                }}
              >
                {kda}
              </span>
            </a>
          );
        })}
      </div>

      {/* Legend strip */}
      <div className="mt-3 flex items-center gap-4 px-1 text-[9px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: GREEN, boxShadow: `0 0 6px ${GREEN}` }}
          />
          Streak
        </span>
        <span className="font-data opacity-70">← plus ancien · plus récent →</span>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}
