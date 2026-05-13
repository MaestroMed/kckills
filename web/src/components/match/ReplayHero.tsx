"use client";

/**
 * ReplayHero — full-bleed cinematic hero for the /match/[slug] viewer.
 *
 * Wave 30d : replaces the smaller `MatchHero` (kept for the legacy page
 * variant) with a 16:9 backdrop sourced from the match's signature kill
 * thumbnail, heavy gradient to the surface color, and a commanding score
 * line under it. Football-club premium quality — the page fans link in
 * Discord after a match.
 *
 * Layout :
 *   - Full-bleed bg (out-of-flow via `width: 100vw, margin-left: -50vw`).
 *   - Backdrop = signature kill thumbnail (or solid gradient fallback).
 *   - Top strip : tournament + stage + "Mardi 12 mai 2026 · 19:00 CET".
 *   - Middle : huge SCORE block with logos either side (counts up on mount).
 *   - Below score : game pills "G1 · G2 · G3" colored by KC win/loss.
 *     Clicking a pill smooth-scrolls to that game's section.
 *   - Bottom-left CTA : "Voir tous les kills" anchored to the kill list.
 *
 * Animations :
 *   - useMotionValue + spring on the two score digits — counts up from 0
 *     to the final value on mount.
 *   - Logos fade-in from sides via Motion variants.
 *   - prefers-reduced-motion : numbers snap to final, no fade transforms.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  animate,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";

// ─── Types ────────────────────────────────────────────────────────────

export interface ReplayHeroProps {
  /** KC logo URL. */
  kcLogoSrc: string;
  /** KC team display name (defaults to "Karmine Corp"). */
  kcName?: string;
  /** Opponent full name. */
  opponentName: string;
  /** 3-letter opponent code. */
  opponentCode: string;
  /** Optional opponent logo. */
  opponentLogoSrc?: string | null;
  /** Final score : KC games won. */
  kcScore: number;
  /** Final score : opponent games won. */
  opponentScore: number;
  /** True when KC won the BO. */
  kcWon: boolean;
  /** League / tournament name. */
  league: string;
  /** Stage label ("Playoffs", "Lower Bracket Final", "Week 4 Day 1"…). */
  stage: string;
  /** Best-of (1, 3, 5). */
  bestOf: number;
  /** ISO 8601 scheduled timestamp. */
  date: string;
  /** Optional backdrop URL — usually the highest-scored kill's thumbnail. */
  backdropUrl?: string | null;
  /** Number of published clips — surfaces a "5 clips disponibles" badge. */
  publishedClipCount?: number;
  /** Game pills payload. */
  games: ReadonlyArray<{
    number: number;
    kcWon: boolean | null;
    winnerKnown: boolean;
  }>;
  /** Optional anchor id of the kill feed section — used by the CTA link. */
  killsAnchor?: string;
  /** Optional anchor prefix for the game pills (matches MatchTimeline). */
  gameAnchorPrefix?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────

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

function formatDate(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function formatTime(date: string): string {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

// ─── Score counter ────────────────────────────────────────────────────

function ScoreNumber({
  target,
  reducedMotion,
  className,
}: {
  target: number;
  reducedMotion: boolean;
  className?: string;
}) {
  const mv = useMotionValue(reducedMotion ? target : 0);
  const display = useTransform(mv, (v) => Math.round(v));

  useEffect(() => {
    if (reducedMotion) {
      mv.set(target);
      return;
    }
    const controls = animate(mv, target, {
      duration: 0.9,
      ease: [0.16, 1, 0.3, 1],
      delay: 0.15,
    });
    return () => controls.stop();
  }, [target, reducedMotion, mv]);

  return <motion.span className={className}>{display}</motion.span>;
}

// ─── Component ────────────────────────────────────────────────────────

export function ReplayHero({
  kcLogoSrc,
  kcName = "Karmine Corp",
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
  backdropUrl,
  publishedClipCount = 0,
  games,
  killsAnchor = "kills-feed",
  gameAnchorPrefix = "game",
}: ReplayHeroProps) {
  const reduced = usePrefersReducedMotion();
  const isPast = new Date(date).getTime() < Date.now();
  const dateLabel = formatDate(date);
  const timeLabel = formatTime(date);

  const accent = isPast ? (kcWon ? "gold" : "red") : "cyan";
  const accentRgb = {
    gold: "200,170,110",
    red: "232,64,87",
    cyan: "10,200,185",
  }[accent];

  const kicker = isPast
    ? kcWon
      ? "★ Victoire Karmine Corp"
      : "✗ Défaite — KC encaisse"
    : "▽ Match à venir";

  return (
    <section
      aria-label={`Hero du match Karmine Corp ${kcScore}-${opponentScore} ${opponentName}`}
      className="relative overflow-hidden"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* Cinematic 16:9 backdrop. Falls back to a solid gradient when
          no signature thumbnail exists (data-only matches, upcoming). */}
      <div className="relative aspect-[21/9] min-h-[420px] md:min-h-[520px] w-full bg-[var(--bg-primary)]">
        {backdropUrl ? (
          <Image
            src={backdropUrl}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover scale-105"
            style={{ filter: "brightness(0.35) saturate(1.1)" }}
            unoptimized
          />
        ) : (
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, var(--bg-primary) 0%, var(--bg-elevated) 60%, var(--bg-surface) 100%)",
            }}
          />
        )}

        {/* Gradient mask — bottom-heavy so the score reads cleanly. */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(1,10,19,0.25) 0%, rgba(1,10,19,0.55) 35%, rgba(1,10,19,0.95) 75%, var(--bg-primary) 100%)",
          }}
        />
        {/* Subtle accent glow keyed to win/loss/upcoming. */}
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 60% 40% at 50% 60%, rgba(${accentRgb},0.18) 0%, transparent 65%)`,
          }}
        />
        {/* Hairline accents. */}
        <span
          aria-hidden
          className="absolute top-0 left-0 right-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(200,170,110,0.45), transparent)",
          }}
        />
        <span
          aria-hidden
          className="absolute bottom-0 left-0 right-0 h-px"
          style={{
            background:
              "linear-gradient(90deg, transparent, rgba(200,170,110,0.35), transparent)",
          }}
        />

        {/* Content layout */}
        <div className="absolute inset-0 flex flex-col justify-end">
          <div className="relative z-10 mx-auto w-full max-w-7xl px-4 pb-10 sm:px-6 md:pb-14">
            {/* Top strip : tournament + stage + date */}
            <motion.div
              initial={reduced ? { opacity: 1 } : { opacity: 0, y: -10 }}
              animate={
                reduced
                  ? { opacity: 1, y: 0 }
                  : { opacity: 1, y: 0, transition: { duration: 0.4 } }
              }
              className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1 md:gap-x-4"
            >
              <span
                className="font-data text-[10px] uppercase tracking-[0.4em] font-bold"
                style={{ color: `rgba(${accentRgb},0.95)` }}
              >
                {kicker}
              </span>
              <span className="text-[var(--gold)]/40">◆</span>
              <span className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]">
                {league}
              </span>
              <span className="text-[var(--gold)]/40">·</span>
              <span className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-secondary)]">
                {stage}
              </span>
              <span className="text-[var(--gold)]/40">·</span>
              <span className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-secondary)]">
                Bo{bestOf}
              </span>
              {dateLabel && (
                <>
                  <span className="text-[var(--gold)]/40 hidden md:inline">·</span>
                  <span className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)] hidden md:inline">
                    {dateLabel}
                    {timeLabel ? ` · ${timeLabel}` : ""}
                  </span>
                </>
              )}
            </motion.div>

            {/* Logos + score */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 md:gap-8">
              {/* KC */}
              <motion.div
                initial={reduced ? { opacity: 1 } : { opacity: 0, x: -24 }}
                animate={
                  reduced
                    ? { opacity: 1, x: 0 }
                    : {
                        opacity: 1,
                        x: 0,
                        transition: {
                          duration: 0.55,
                          ease: [0.16, 1, 0.3, 1],
                        },
                      }
                }
                className="flex items-center justify-end gap-3 md:gap-5"
              >
                <div className="text-right">
                  <p className="font-display text-xl md:text-3xl font-black text-[var(--gold)] leading-none tracking-tight">
                    KC
                  </p>
                  <p className="hidden md:block mt-1 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                    {kcName}
                  </p>
                </div>
                <div
                  className="relative grid h-16 w-16 place-items-center rounded-2xl border-2 border-[var(--gold)] bg-[var(--bg-surface)] md:h-24 md:w-24"
                  style={{
                    boxShadow:
                      "0 0 32px rgba(200,170,110,0.3), inset 0 0 12px rgba(200,170,110,0.12)",
                  }}
                >
                  <Image
                    src={kcLogoSrc}
                    alt={kcName}
                    width={72}
                    height={72}
                    priority
                  />
                </div>
              </motion.div>

              {/* Score */}
              <div className="flex flex-col items-center gap-1">
                <p
                  className="font-display text-5xl md:text-8xl font-black tabular-nums leading-none"
                  style={{
                    color: "var(--text-primary)",
                    textShadow: "0 4px 30px rgba(0,0,0,0.5)",
                  }}
                  aria-label={`Score : ${kcScore} - ${opponentScore}`}
                >
                  <ScoreNumber
                    target={kcScore}
                    reducedMotion={reduced}
                    className={kcWon ? "text-[var(--gold)]" : "text-[var(--red)]"}
                  />
                  <span className="text-[var(--text-muted)] mx-1.5 md:mx-3">·</span>
                  <ScoreNumber
                    target={opponentScore}
                    reducedMotion={reduced}
                    className={kcWon ? "text-[var(--red)]" : "text-[var(--gold)]"}
                  />
                </p>
                {!isPast && (
                  <span className="font-data text-[10px] uppercase tracking-widest text-[var(--cyan)]">
                    À venir
                  </span>
                )}
              </div>

              {/* Opponent */}
              <motion.div
                initial={reduced ? { opacity: 1 } : { opacity: 0, x: 24 }}
                animate={
                  reduced
                    ? { opacity: 1, x: 0 }
                    : {
                        opacity: 1,
                        x: 0,
                        transition: {
                          duration: 0.55,
                          ease: [0.16, 1, 0.3, 1],
                          delay: 0.05,
                        },
                      }
                }
                className="flex items-center justify-start gap-3 md:gap-5"
              >
                <div className="relative grid h-16 w-16 place-items-center rounded-2xl border-2 border-white/15 bg-[var(--bg-surface)] md:h-24 md:w-24">
                  {opponentLogoSrc ? (
                    <Image
                      src={opponentLogoSrc}
                      alt={opponentName}
                      width={72}
                      height={72}
                    />
                  ) : (
                    <span className="font-display text-xl md:text-3xl font-black text-white">
                      {opponentCode}
                    </span>
                  )}
                </div>
                <div className="text-left">
                  <p className="font-display text-xl md:text-3xl font-black text-white leading-none tracking-tight">
                    {opponentCode}
                  </p>
                  <p className="hidden md:block mt-1 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                    {opponentName}
                  </p>
                </div>
              </motion.div>
            </div>

            {/* Game pills */}
            {games.length > 0 && (
              <div
                className="mt-6 flex flex-wrap items-center justify-center gap-2 md:mt-8"
                aria-label="Résultats par game"
              >
                {games.map((g) => {
                  const known = g.winnerKnown;
                  const won = known && g.kcWon === true;
                  const lost = known && g.kcWon === false;
                  const cls = won
                    ? "border-[var(--gold)]/60 bg-[var(--gold)]/15 text-[var(--gold)] hover:bg-[var(--gold)]/25"
                    : lost
                      ? "border-[var(--red)]/60 bg-[var(--red)]/15 text-[var(--red)] hover:bg-[var(--red)]/25"
                      : "border-[var(--border-gold)] bg-[var(--bg-surface)] text-[var(--text-muted)] hover:border-[var(--gold)]/40";
                  const label = won ? "Win" : lost ? "Loss" : "—";
                  return (
                    <Link
                      key={g.number}
                      href={`#${gameAnchorPrefix}-${g.number}`}
                      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-data text-[11px] font-semibold uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] ${cls}`}
                    >
                      <span>Game {g.number}</span>
                      <span aria-hidden className="text-[9px] opacity-70">
                        ·
                      </span>
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </div>
            )}

            {/* CTA + clip badge */}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-4 md:mt-8">
              <Link
                href={`#${killsAnchor}`}
                className="inline-flex items-center gap-2 rounded-full border border-[var(--gold)]/40 bg-[var(--gold)]/10 px-4 py-2 font-display text-xs font-bold uppercase tracking-widest text-[var(--gold)] transition-colors hover:bg-[var(--gold)]/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)]"
              >
                <span>Voir tous les kills</span>
                <svg
                  className="h-3 w-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.4}
                  viewBox="0 0 24 24"
                  aria-hidden
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 12h14M13 5l7 7-7 7"
                  />
                </svg>
              </Link>

              {publishedClipCount > 0 && (
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
                  {publishedClipCount} clips vidéo
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
