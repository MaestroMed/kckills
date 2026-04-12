"use client";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Area,
  AreaChart,
} from "recharts";

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
const CYAN = "#0AC8B9";
const RED = "#E84057";
const GREEN = "#00C853";
const BG = "#0A1428";

export function EraComparisonChart({ data }: { data: EraStats[] }) {
  if (data.length < 2) return null;

  return (
    <div className="space-y-6">
      {/* Winrate evolution */}
      <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
        <h3 className="font-display text-sm font-bold text-[var(--text-secondary)] mb-4">
          Winrate par &egrave;re
        </h3>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,170,110,0.1)" />
              <XAxis
                dataKey="period"
                tick={{ fill: "#A09B8C", fontSize: 9 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: "#5B6A8A", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                contentStyle={{
                  background: BG,
                  border: "1px solid rgba(200,170,110,0.3)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#F0E6D2",
                }}
                formatter={(value) => [`${Number(value).toFixed(0)}%`, "Winrate"]}
              />
              <defs>
                <linearGradient id="winrateGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={GREEN} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={GREEN} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area
                type="monotone"
                dataKey="winRate"
                stroke={GREEN}
                fill="url(#winrateGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Kills per game evolution */}
      <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
        <h3 className="font-display text-sm font-bold text-[var(--text-secondary)] mb-4">
          Kills/game par &egrave;re
        </h3>
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(200,170,110,0.1)" />
              <XAxis
                dataKey="period"
                tick={{ fill: "#A09B8C", fontSize: 9 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "#5B6A8A", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: BG,
                  border: "1px solid rgba(200,170,110,0.3)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "#F0E6D2",
                }}
              />
              <Line
                type="monotone"
                dataKey="avgKcKills"
                stroke={GOLD}
                strokeWidth={2}
                dot={{ fill: GOLD, r: 3 }}
                name="KC kills/game"
              />
              <Line
                type="monotone"
                dataKey="avgOppKills"
                stroke={RED}
                strokeWidth={2}
                strokeDasharray="4 4"
                dot={{ fill: RED, r: 3 }}
                name="Adversaire kills/game"
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
