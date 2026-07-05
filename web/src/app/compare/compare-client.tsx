"use client";

import { useState } from "react";
import Image from "next/image";
import { championIconUrl } from "@/lib/constants";
import { useT } from "@/lib/i18n/use-lang";

export interface ComparablePlayer {
  name: string;
  role: string;
  games: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  topChamps: { name: string; games: number; wins: number }[];
}

/** Two-column duel: pick a player per side, rows highlight the winner. */
export function CompareClient({ players }: { players: ComparablePlayer[] }) {
  const t = useT();
  const [aName, setAName] = useState(players[0]?.name ?? "");
  const [bName, setBName] = useState(players[1]?.name ?? "");
  const a = players.find((p) => p.name === aName) ?? players[0];
  const b = players.find((p) => p.name === bName) ?? players[1];
  if (!a || !b) return null;

  const kda = (p: ComparablePlayer) =>
    p.deaths > 0 ? (p.kills + p.assists) / p.deaths : p.kills + p.assists;
  const wr = (p: ComparablePlayer) =>
    p.games > 0 ? Math.round((p.wins / p.games) * 100) : 0;

  const rows: { label: string; va: number; vb: number; fmt: (n: number) => string }[] = [
    { label: t("p_compare.games"), va: a.games, vb: b.games, fmt: String },
    { label: t("p_compare.winrate"), va: wr(a), vb: wr(b), fmt: (n) => `${n}%` },
    { label: t("p_compare.kda"), va: kda(a), vb: kda(b), fmt: (n) => n.toFixed(2) },
    { label: t("p_compare.kills"), va: a.kills, vb: b.kills, fmt: String },
    { label: t("p_compare.deaths"), va: a.deaths, vb: b.deaths, fmt: String },
    { label: t("p_compare.assists"), va: a.assists, vb: b.assists, fmt: String },
  ];

  const select = (
    value: string,
    onChange: (v: string) => void,
    label: string,
    exclude: string,
  ) => (
    <label className="block flex-1">
      <span className="mb-1 block text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm font-bold text-white focus:border-[var(--gold)]/60 focus:outline-none"
      >
        {players
          .filter((p) => p.name !== exclude)
          .map((p) => (
            <option key={p.name} value={p.name} className="bg-[var(--bg-primary)]">
              {p.name} — {p.role.toUpperCase()}
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-8">
      {/* Duel header */}
      <div className="flex items-end gap-4">
        {select(aName || a.name, setAName, t("p_compare.pick_a"), bName || b.name)}
        <span
          aria-hidden
          className="pb-3 font-display text-2xl font-black text-[var(--gold)]"
        >
          VS
        </span>
        {select(bName || b.name, setBName, t("p_compare.pick_b"), aName || a.name)}
      </div>

      {/* Stat rows — the better side glows gold. "Deaths": lower wins. */}
      <div className="overflow-hidden rounded-2xl border border-[var(--border-gold)]">
        {rows.map((r, i) => {
          const lowerWins = r.label === t("p_compare.deaths");
          const aWins = lowerWins ? r.va < r.vb : r.va > r.vb;
          const bWins = lowerWins ? r.vb < r.va : r.vb > r.va;
          return (
            <div
              key={r.label}
              className={`grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-3 ${
                i % 2 === 0 ? "bg-[var(--bg-surface)]" : "bg-[var(--bg-elevated)]/50"
              }`}
            >
              <span
                className={`font-data text-lg font-black tabular-nums ${
                  aWins ? "text-[var(--gold)]" : "text-white/70"
                }`}
              >
                {r.fmt(r.va)}
              </span>
              <span className="text-center text-[10px] uppercase tracking-[0.2em] text-[var(--text-muted)]">
                {r.label}
              </span>
              <span
                className={`text-right font-data text-lg font-black tabular-nums ${
                  bWins ? "text-[var(--gold)]" : "text-white/70"
                }`}
              >
                {r.fmt(r.vb)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Champion pools */}
      <div className="grid gap-6 md:grid-cols-2">
        {[a, b].map((p) => (
          <div key={p.name}>
            <h2 className="font-display text-sm font-bold uppercase tracking-widest text-[var(--text-secondary)]">
              {p.name} — {t("p_compare.top_champs")}
            </h2>
            <ul className="mt-3 space-y-2">
              {p.topChamps.map((c) => (
                <li
                  key={c.name}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-[var(--bg-surface)] px-3 py-2"
                >
                  <Image
                    src={championIconUrl(c.name)}
                    alt={c.name}
                    width={32}
                    height={32}
                    className="rounded-lg border border-[var(--gold)]/20"
                  />
                  <span className="flex-1 text-sm font-bold text-white">{c.name}</span>
                  <span className="font-data text-xs text-[var(--text-muted)]">
                    {c.games}G · {c.games > 0 ? Math.round((c.wins / c.games) * 100) : 0}%
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
