"use client";

/**
 * MatchHero — cinematic match-page hero.
 *
 * Replaces the stacked "logos + result" header with a single commanding
 * fold : huge KC ⚔ opponent logos, gradient that flexes to win/loss, the
 * score as a serif-display moment, scheduled date in a calmer typographic
 * register beneath, and a kicker line that says exactly what's at stake.
 *
 * Design choices :
 *   * Win → gold-cyan gradient ; Loss → red-anthracite ; Pending → blue.
 *   * Score uses Cinzel display at 6-8rem, monospace digits via tabular-nums
 *     so the kerning stays clean across "1-3" and "10-12".
 *   * Both team logos float above a subtle radial glow (gold for KC, team
 *     accent for opponent — only when we know the team). Hovering the
 *     opponent badge nudges it like a duel-frame nudge.
 *   * Kicker line shows the LEC stage + best-of + date in muted caps.
 *   * Animated arrow between the two badges (CSS only, prefers-reduced-motion
 *     respected) — same idea as KillCinematicView so both pages share a
 *     visual language.
 *
 * Stays a Client Component for the small useEffect that triggers a
 * one-shot CSS reveal class on mount (avoids the SSR / hydration flash
 * for the score number).
 */

import { useEffect, useState } from "react";
import Image from "next/image";

interface MatchHeroProps {
  kcLogoSrc: string;
  opponentName: string;
  opponentCode: string;
  opponentLogoSrc?: string | null;
  kcScore: number;
  opponentScore: number;
  kcWon: boolean;
  league: string;
  stage: string;
  bestOf: number;
  date: string; // ISO
  /** Number of clip kills published for this match — surfaces a kicker badge */
  publishedClipCount?: number;
}

export function MatchHero({
  kcLogoSrc,
  opponentName,
  opponentCode,
  opponentLogoSrc,
  kcScore,
  opponentScore,
  kcWon,
  league,
  stage,
  bestOf,
  date,
  publishedClipCount = 0,
}: MatchHeroProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const dateObj = new Date(date);
  const isPast = dateObj.getTime() < Date.now();
  const dateLabel = dateObj.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Status accent color : gold for win, red for loss, cyan for upcoming
  const isWin = isPast && kcWon;
  const isLoss = isPast && !kcWon;
  const accent = isWin ? "gold" : isLoss ? "red" : "cyan";
  const accentRgb = {
    gold: "200,170,110",
    red: "232,64,87",
    cyan: "10,200,185",
  }[accent];

  const kicker = isPast
    ? isWin
      ? "★ Victoire Karmine Corp"
      : "✗ Défaite — KC encaisse"
    : "▽ Match à venir";

  return (
    <section
      className="relative overflow-hidden -mx-6 md:-mx-8 lg:-mx-12 -mt-6"
      style={{
        background:
          "linear-gradient(180deg, rgba(1,10,19,0.0), rgba(15,29,54,0.6) 30%, rgba(15,29,54,0.6) 70%, rgba(1,10,19,0.0))",
      }}
    >
      {/* Subtle radial glow keyed to win/loss */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse 70% 50% at 50% 50%, rgba(${accentRgb},0.10) 0%, transparent 65%)`,
        }}
      />

      {/* Top + bottom hairline accents */}
      <span
        aria-hidden
        className="absolute top-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(200,170,110,0.5), transparent)",
        }}
      />
      <span
        aria-hidden
        className="absolute bottom-0 left-0 right-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(200,170,110,0.3), transparent)",
        }}
      />

      <style>{`
        @keyframes kc-arrow-pulse-h {
          0%, 100% { transform: translateX(0)    scale(1); }
          50%      { transform: translateX(3px) scale(1.06); }
        }
        @keyframes kc-score-rise {
          0%   { opacity: 0; transform: translateY(20px) scale(0.94); }
          70%  { opacity: 1; }
          100% { opacity: 1; transform: translateY(0)    scale(1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .kc-score-rise { animation: none !important; opacity: 1 !important; transform: none !important; }
        }
      `}</style>

      <div className="relative z-10 max-w-6xl mx-auto px-6 py-10 md:py-14">
        {/* Kicker */}
        <p
          className="font-data text-[10px] uppercase tracking-[0.4em] text-center mb-4 md:mb-6"
          style={{ color: `rgba(${accentRgb},0.85)` }}
        >
          {kicker}
        </p>

        {/* Logos + score */}
        <div className="flex items-center justify-center gap-4 md:gap-10">
          {/* KC */}
          <div className="flex flex-col items-center gap-3">
            <div
              className="relative grid place-items-center h-20 w-20 md:h-28 md:w-28 rounded-2xl border-2 border-[var(--gold)] bg-[var(--bg-surface)]"
              style={{
                boxShadow: "0 0 32px rgba(200,170,110,0.3), inset 0 0 12px rgba(200,170,110,0.12)",
              }}
            >
              <Image src={kcLogoSrc} alt="Karmine Corp" width={84} height={84} priority />
            </div>
            <p className="font-display text-sm md:text-base font-black text-[var(--gold)] tracking-wide">
              KC
            </p>
          </div>

          {/* Score block */}
          <div className="flex flex-col items-center gap-1">
            <p
              className={`font-display text-6xl md:text-8xl font-black tabular-nums leading-none ${
                mounted ? "kc-score-rise" : "opacity-0"
              }`}
              style={{
                color: "var(--text-primary)",
                animation: mounted ? "kc-score-rise 800ms cubic-bezier(.16,1,.3,1)" : "none",
                textShadow: "0 4px 30px rgba(0,0,0,0.5)",
              }}
            >
              <span className={isWin ? "text-[var(--gold)]" : isLoss ? "text-[var(--red)]" : ""}>
                {kcScore}
              </span>
              <span className="text-[var(--text-muted)] mx-2 md:mx-3">·</span>
              <span className={isLoss ? "text-[var(--gold)]" : isWin ? "text-[var(--red)]" : ""}>
                {opponentScore}
              </span>
            </p>
            {!isPast && (
              <span className="font-data text-[10px] uppercase tracking-widest text-[var(--cyan)]">
                Bo{bestOf}
              </span>
            )}
          </div>

          {/* Opponent */}
          <div className="flex flex-col items-center gap-3 group">
            <div
              className="relative grid place-items-center h-20 w-20 md:h-28 md:w-28 rounded-2xl border-2 border-white/20 bg-[var(--bg-surface)]
                         transition-all duration-500 group-hover:border-white/40 group-hover:scale-105"
              style={{ boxShadow: "0 0 18px rgba(255,255,255,0.05)" }}
            >
              {opponentLogoSrc ? (
                <Image src={opponentLogoSrc} alt={opponentName} width={84} height={84} />
              ) : (
                <span className="font-display text-2xl md:text-3xl font-black text-white">
                  {opponentCode}
                </span>
              )}
            </div>
            <p className="font-display text-sm md:text-base font-black text-white tracking-wide">
              {opponentCode}
            </p>
          </div>
        </div>

        {/* Match metadata strip */}
        <div className="mt-7 md:mt-9 flex items-center justify-center gap-2 flex-wrap text-center">
          <span className="font-data text-[11px] uppercase tracking-widest text-[var(--gold)]">
            {league}
          </span>
          <span className="text-[var(--gold)]/40">·</span>
          <span className="text-[11px] uppercase tracking-widest text-[var(--text-muted)]">
            {stage}
          </span>
          <span className="text-[var(--gold)]/40">·</span>
          <span className="text-[11px] uppercase tracking-widest text-white/80">
            Bo{bestOf}
          </span>
          <span className="text-[var(--gold)]/40">·</span>
          <span className="text-[11px] uppercase tracking-widest text-white/60">
            {dateLabel}
          </span>
        </div>

        {/* Live "clips available" badge */}
        {publishedClipCount > 0 && (
          <div className="mt-6 flex justify-center">
            <span
              className="inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-[11px] font-data font-bold uppercase tracking-widest"
              style={{
                color: `rgba(${accentRgb},1)`,
                borderColor: `rgba(${accentRgb},0.4)`,
                background: `rgba(${accentRgb},0.08)`,
              }}
            >
              <span
                className="h-2 w-2 rounded-full animate-pulse"
                style={{ background: `rgba(${accentRgb},1)` }}
              />
              {publishedClipCount} clips disponibles
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
