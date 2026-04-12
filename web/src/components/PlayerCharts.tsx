"use client";

import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
} from "recharts";

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
const CYAN = "#0AC8B9";
const RED = "#E84057";
const GREEN = "#00C853";
const BG = "#0A1428";

/**
 * Radar chart — player strengths across kill, assist, survive, CS, gold dimensions.
 */
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
  const avgGold = gamesPlayed > 0 ? totalGold / gamesPlayed / 1000 : 0;
  const avgCS = gamesPlayed > 0 ? totalCS / gamesPlayed : 0;
  const surviveRate = avgDeaths > 0 ? Math.min(10, 10 / avgDeaths) : 10;

  const data = [
    { stat: "Kills", value: Math.min(10, avgKills * 1.5), fullMark: 10 },
    { stat: "Assists", value: Math.min(10, avgAssists * 1.2), fullMark: 10 },
    { stat: "Survie", value: surviveRate, fullMark: 10 },
    { stat: "CS/min", value: Math.min(10, avgCS / 25), fullMark: 10 },
    { stat: "Gold", value: Math.min(10, avgGold / 1.5), fullMark: 10 },
  ];

  return (
    <div className="w-full aspect-square max-w-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data}>
          <PolarGrid stroke="rgba(200,170,110,0.15)" />
          <PolarAngleAxis
            dataKey="stat"
            tick={{ fill: "#A09B8C", fontSize: 11 }}
          />
          <Radar
            dataKey="value"
            stroke={GOLD}
            fill={GOLD}
            fillOpacity={0.2}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Champion performance bar chart — top champions by games played with KDA overlay.
 */
export function ChampionPerformanceChart({
  champions,
}: {
  champions: ChampionStat[];
}) {
  const data = champions.slice(0, 8).map((c) => ({
    name: c.name.length > 8 ? c.name.slice(0, 7) + "\u2026" : c.name,
    fullName: c.name,
    games: c.games,
    kda:
      c.deaths > 0
        ? +((c.kills + c.assists) / c.deaths).toFixed(1)
        : +(c.kills + c.assists).toFixed(1),
  }));

  return (
    <div className="w-full h-[220px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barSize={24}>
          <XAxis
            dataKey="name"
            tick={{ fill: "#A09B8C", fontSize: 10 }}
            axisLine={{ stroke: "rgba(200,170,110,0.15)" }}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              background: BG,
              border: "1px solid rgba(200,170,110,0.3)",
              borderRadius: 8,
              fontSize: 12,
              color: "#F0E6D2",
            }}
            formatter={(value) => [
              String(value),
              "Games",
            ]}
            labelFormatter={(label) => {
              const item = data.find((d) => d.name === label);
              return item?.fullName ?? label;
            }}
          />
          <Bar dataKey="games" radius={[4, 4, 0, 0]}>
            {data.map((_, i) => (
              <Cell key={i} fill={i === 0 ? GOLD : CYAN} fillOpacity={0.7} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Recent form — last 10 matches as W/L streaks with KDA dots.
 */
export function RecentFormChart({
  history,
}: {
  history: MatchEntry[];
}) {
  const recent = history.slice(0, 15).reverse();
  const data = recent.map((m, i) => ({
    idx: i + 1,
    kda:
      m.deaths > 0
        ? +((m.kills + m.assists) / m.deaths).toFixed(1)
        : +(m.kills + m.assists).toFixed(1),
    won: m.won,
    opponent: m.opponent,
    champion: m.champion,
  }));

  return (
    <div className="w-full h-[180px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} barSize={16}>
          <XAxis
            dataKey="idx"
            tick={{ fill: "#5B6A8A", fontSize: 9 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis hide />
          <Tooltip
            contentStyle={{
              background: BG,
              border: "1px solid rgba(200,170,110,0.3)",
              borderRadius: 8,
              fontSize: 12,
              color: "#F0E6D2",
            }}
            formatter={(value) => [Number(value).toFixed(1), "KDA"]}
            labelFormatter={(label) => {
              const item = data.find((d) => d.idx === label);
              return item ? `vs ${item.opponent} (${item.champion})` : "";
            }}
          />
          <Bar dataKey="kda" radius={[4, 4, 0, 0]}>
            {data.map((entry, i) => (
              <Cell
                key={i}
                fill={entry.won ? GREEN : RED}
                fillOpacity={0.8}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
