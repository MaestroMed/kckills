"use client";

/**
 * TrainVi — Le Train Vi : KC momentum tracker.
 *
 * Wave 32 — visualises Karmine Corp's recent form as a Hextech-flavoured
 * train of wagons rolling out of a Vi-themed locomotive. Each wagon is
 * one match (newest on the LEFT, next to the locomotive). Wins glow gold,
 * losses look derailed. The locomotive face shows the current consecutive
 * streak as a big number.
 *
 * Naming nod : Vi (Piltover Enforcer, hextech gauntlets, charges through
 * everything in her path). "Le train Vi" = unstoppable momentum train.
 *
 * Data contract :
 *   matches: most-recent-first array of { id, date, opponent, kc_won, ... }
 *
 * Visual :
 *   ┌──────────────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐
 *   │  ⚙ LOCO Vi  │ │ W  │ │ W  │ │ W  │ │ L  │ │ W  │ │ L  │ →
 *   │   STREAK 3  │ │ G2 │ │ FNC│ │ VIT│ │ MKO│ │ KOI│ │ TH │
 *   │   • • • •   │ │1-0 │ │2-0 │ │1-0 │ │0-1 │ │2-1 │ │0-1 │
 *   └──────────────┘ └────┘ └────┘ └────┘ └────┘ └────┘ └────┘
 *   ════════════════════════════════════════════════════════════ (rails)
 *
 * Accessibility :
 *   - role="list" on the wagons container, role="listitem" per wagon
 *   - aria-label summarises the streak in plain French
 *   - prefers-reduced-motion : drop the slide-in + steam particles, keep
 *     hover scale at 1 to avoid layout shift
 *   - Each wagon is a real <Link> so keyboard tab cycles through them
 *
 * The locomotive is a stylised hextech contraption with a glowing core
 * that pulses when the streak is positive. Mobile collapses to a
 * horizontally-scrollable strip with the locomotive sticky on the left.
 */

import Link from "next/link";
import { useMemo } from "react";
import { m, useReducedMotion } from "motion/react";

import { TEAM_LOGOS } from "@/lib/kc-assets";
import Image from "next/image";

interface TrainMatch {
  id: string;
  date: string;
  opponent: { name: string; code: string };
  kc_won: boolean;
  kc_score: number;
  opp_score: number;
  best_of: number;
}

interface Props {
  /** Most-recent-first array. We slice the first ~12. */
  matches: TrainMatch[];
}

interface StreakInfo {
  /** Length of the current streak (>= 0). */
  count: number;
  /** Whether the active streak is a win streak. False = loss streak.
   *  Meaningless when count === 0. */
  isWin: boolean;
  /** Best/worst contextual label for the locomotive headline. */
  label: string;
  /** Tone of the locomotive (drives accent color). */
  tone: "hype" | "neutral" | "danger";
}

function computeStreak(matches: TrainMatch[]): StreakInfo {
  if (matches.length === 0) {
    return { count: 0, isWin: false, label: "GARE", tone: "neutral" };
  }
  const first = matches[0]!.kc_won;
  let count = 1;
  for (let i = 1; i < matches.length; i++) {
    if (matches[i]!.kc_won === first) count += 1;
    else break;
  }
  if (first) {
    return {
      count,
      isWin: true,
      label:
        count >= 5
          ? "ROULEAU COMPRESSEUR"
          : count >= 3
            ? "LE TRAIN ROULE"
            : "EN MARCHE",
      tone: "hype",
    };
  }
  return {
    count,
    isWin: false,
    label:
      count >= 3 ? "EN PANNE" : count >= 2 ? "RALENTI" : "BUMP",
    tone: "danger",
  };
}

const dateFmt = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "short",
});

export function TrainVi({ matches }: Props) {
  const reduced = useReducedMotion();
  const wagons = useMemo(() => matches.slice(0, 10), [matches]);
  const streak = useMemo(() => computeStreak(wagons), [wagons]);

  if (wagons.length === 0) return null;

  // Tone-driven color palette. Cyan = Vi gauntlets primed, gold = warm,
  // red = engine sputtering.
  const accent =
    streak.tone === "hype"
      ? "var(--cyan)"
      : streak.tone === "danger"
        ? "var(--red)"
        : "var(--gold)";

  const wins = wagons.filter((m) => m.kc_won).length;
  const losses = wagons.length - wins;
  const winRate = wagons.length > 0 ? Math.round((wins / wagons.length) * 100) : 0;

  return (
    <section
      className="relative max-w-7xl mx-auto px-4 md:px-6 py-12 md:py-16"
      aria-labelledby="train-vi-heading"
    >
      {/* ─── Header band ──────────────────────────────────────────── */}
      <header className="flex flex-wrap items-end justify-between gap-3 mb-6 md:mb-8">
        <div>
          <p
            className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.35em]"
            style={{ color: accent }}
          >
            Momentum tracker
          </p>
          <h2
            id="train-vi-heading"
            className="font-display text-3xl md:text-5xl font-black uppercase tracking-tight text-white mt-1"
          >
            Le Train{" "}
            <span style={{ color: accent }}>Vi</span>
          </h2>
          <p className="text-xs md:text-sm text-[var(--text-muted)] mt-2 max-w-xl">
            10 dernières séries KC. La locomotive carbure à la victoire. Quand
            le train roule, c&apos;est rouleau compresseur. Quand il déraille,
            la gare est trop calme.
          </p>
        </div>

        {/* Form snapshot pills */}
        <div className="flex items-center gap-2 text-xs">
          <Pill label="V" value={wins} tone="hype" />
          <Pill label="D" value={losses} tone="danger" />
          <Pill label="WR" value={`${winRate}%`} tone={winRate >= 50 ? "hype" : "danger"} />
        </div>
      </header>

      {/* ─── Train strip ──────────────────────────────────────────── */}
      <div
        className="relative overflow-x-auto pb-6"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="relative flex items-stretch gap-3 min-w-max pr-6">
          {/* Locomotive */}
          <Locomotive streak={streak} accent={accent} reduced={!!reduced} />

          {/* Wagons (newest first) */}
          <ol
            role="list"
            className="flex items-stretch gap-2"
            aria-label="Les 10 dernières séries KC, de la plus récente à la plus ancienne"
          >
            {wagons.map((match, idx) => (
              <Wagon
                key={match.id}
                match={match}
                index={idx}
                reduced={!!reduced}
              />
            ))}
          </ol>
        </div>

        {/* Hextech rails — two parallel lines with bolts every 80px */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-2 h-2"
          style={{
            backgroundImage: `
              repeating-linear-gradient(90deg, transparent 0 40px, ${accent}88 40px 42px, transparent 42px 80px),
              linear-gradient(180deg, transparent 0 7px, ${accent}55 7px 8px, transparent 8px 100%)
            `,
          }}
        />
      </div>

      {/* ─── Status line below the train ──────────────────────────── */}
      <div className="mt-3 flex items-center justify-between flex-wrap gap-2 text-[10px] md:text-xs text-[var(--text-muted)]">
        <p className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent }} />
          <span>
            {streak.count === 0
              ? "Aucune série enregistrée"
              : streak.isWin
                ? `${streak.count} victoire${streak.count > 1 ? "s" : ""} d'affilée. Le train ${streak.tone === "hype" ? "carbure" : "roule"}.`
                : `${streak.count} défaite${streak.count > 1 ? "s" : ""} d'affilée. Sortie de voie.`}
          </span>
        </p>
        <Link
          href="/matches"
          className="inline-flex items-center gap-1.5 text-[var(--text-secondary)] hover:text-[var(--gold)] uppercase tracking-widest font-bold"
        >
          Voir tous les matchs <span aria-hidden>→</span>
        </Link>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Locomotive
// ════════════════════════════════════════════════════════════════════

function Locomotive({
  streak,
  accent,
  reduced,
}: {
  streak: StreakInfo;
  accent: string;
  reduced: boolean;
}) {
  return (
    <m.div
      initial={reduced ? false : { x: -40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: "spring", stiffness: 180, damping: 22 }}
      className="relative w-44 md:w-52 shrink-0 overflow-hidden rounded-2xl border-2 bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-primary)]"
      style={{
        borderColor: `${accent}80`,
        boxShadow: `0 0 0 1px ${accent}33, 0 0 60px -10px ${accent}aa, inset 0 0 30px ${accent}15`,
      }}
      aria-label={`Locomotive Vi — ${streak.label}, série de ${streak.count}`}
    >
      {/* Hextech core — pulsing hexagon */}
      <m.div
        aria-hidden
        animate={
          reduced || streak.tone !== "hype"
            ? undefined
            : { scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }
        }
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-x-0 top-3 mx-auto h-12 w-12 md:h-14 md:w-14"
      >
        <svg viewBox="0 0 60 60" className="h-full w-full">
          <defs>
            <radialGradient id="vi-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor={accent} stopOpacity="0.9" />
              <stop offset="60%" stopColor={accent} stopOpacity="0.3" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </radialGradient>
          </defs>
          {/* Outer hexagon */}
          <polygon
            points="30,4 52,17 52,43 30,56 8,43 8,17"
            fill="url(#vi-core)"
            stroke={accent}
            strokeWidth="1.2"
          />
          {/* Inner hex */}
          <polygon
            points="30,16 42,23 42,37 30,44 18,37 18,23"
            fill={`${accent}22`}
            stroke={accent}
            strokeWidth="0.8"
          />
          {/* "VI" letters */}
          <text
            x="30"
            y="34"
            textAnchor="middle"
            className="font-display"
            fontSize="11"
            fontWeight="900"
            fill={accent}
            style={{ letterSpacing: "0.05em" }}
          >
            VI
          </text>
        </svg>
      </m.div>

      {/* Big streak number */}
      <div className="relative pt-20 md:pt-24 pb-4 px-4 text-center">
        <m.p
          key={streak.count}
          initial={reduced ? false : { y: 8, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="font-data text-5xl md:text-6xl font-black tabular-nums leading-none"
          style={{ color: accent, textShadow: `0 0 40px ${accent}aa` }}
        >
          {streak.count}
        </m.p>
        <p className="mt-2 font-display text-[10px] md:text-[11px] font-bold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
          {streak.label}
        </p>

        {/* Dots — one per match in the streak, lit by tone */}
        <div className="mt-3 flex items-center justify-center gap-1">
          {Array.from({ length: Math.max(1, Math.min(streak.count, 6)) }).map((_, i) => (
            <span
              key={i}
              aria-hidden
              className="h-1 w-1 rounded-full"
              style={{ backgroundColor: accent, boxShadow: `0 0 6px ${accent}` }}
            />
          ))}
          {streak.count > 6 && (
            <span
              aria-hidden
              className="font-data text-[9px] tabular-nums"
              style={{ color: accent }}
            >
              +{streak.count - 6}
            </span>
          )}
        </div>
      </div>

      {/* Steam particles (top edge) — hidden when reduced or not hyped */}
      {!reduced && streak.tone === "hype" && streak.count >= 2 && (
        <>
          {[0, 1, 2].map((i) => (
            <m.span
              key={i}
              aria-hidden
              initial={{ y: 0, opacity: 0 }}
              animate={{ y: -28, opacity: [0, 0.6, 0] }}
              transition={{
                duration: 2,
                repeat: Infinity,
                delay: i * 0.6,
                ease: "easeOut",
              }}
              className="absolute h-2 w-2 rounded-full pointer-events-none"
              style={{
                left: `${30 + i * 12}%`,
                top: "8%",
                backgroundColor: `${accent}40`,
                boxShadow: `0 0 8px ${accent}80`,
              }}
            />
          ))}
        </>
      )}

      {/* Headlight bottom-right */}
      <span
        aria-hidden
        className="absolute bottom-2 right-2 h-3 w-3 rounded-full"
        style={{
          backgroundColor: accent,
          boxShadow: `0 0 14px ${accent}, 0 0 30px ${accent}88`,
        }}
      />
    </m.div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Wagon
// ════════════════════════════════════════════════════════════════════

function Wagon({
  match,
  index,
  reduced,
}: {
  match: TrainMatch;
  index: number;
  reduced: boolean;
}) {
  const won = match.kc_won;
  const accent = won ? "var(--gold)" : "var(--red)";
  const logo = TEAM_LOGOS[match.opponent.code];
  const dateLabel = match.date ? dateFmt.format(new Date(match.date)) : "";

  return (
    <m.li
      role="listitem"
      initial={reduced ? false : { x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{
        type: "spring",
        stiffness: 180,
        damping: 22,
        delay: reduced ? 0 : 0.05 + index * 0.04,
      }}
      whileHover={reduced ? undefined : { y: -4 }}
      className="relative w-24 md:w-28 shrink-0"
    >
      <Link
        href={`/match/${match.id}`}
        className={`group flex h-full flex-col items-center gap-2 rounded-xl border bg-[var(--bg-surface)] p-3 transition-all hover:bg-[var(--bg-elevated)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)] ${
          won ? "" : "opacity-70 grayscale hover:opacity-90 hover:grayscale-0"
        }`}
        style={{
          borderColor: `${accent}55`,
          boxShadow: won
            ? `inset 0 0 0 1px ${accent}30, 0 0 24px -16px ${accent}aa`
            : `inset 0 0 0 1px ${accent}20`,
        }}
        aria-label={`${dateLabel} — ${match.kc_won ? "Victoire" : "Défaite"} ${match.kc_score}-${match.opp_score} contre ${match.opponent.code}`}
      >
        {/* W / L stamp */}
        <span
          aria-hidden
          className="absolute top-1 right-1 font-display text-[9px] font-black tracking-widest"
          style={{ color: accent }}
        >
          {won ? "W" : "L"}
        </span>

        {/* Opponent logo */}
        <div
          className="relative h-9 w-9 md:h-10 md:w-10 rounded-full overflow-hidden border bg-[var(--bg-elevated)]"
          style={{ borderColor: `${accent}66` }}
        >
          {logo ? (
            <Image
              src={logo}
              alt={match.opponent.code}
              fill
              sizes="40px"
              className="object-contain p-1"
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center font-display text-[10px] font-bold text-[var(--text-muted)]">
              {match.opponent.code.slice(0, 3)}
            </span>
          )}
        </div>

        {/* Opponent code */}
        <p className="font-display text-[10px] md:text-xs font-bold uppercase tracking-wider text-white truncate w-full text-center">
          {match.opponent.code}
        </p>

        {/* Score */}
        <p className="font-data text-sm md:text-base font-black tabular-nums leading-none">
          <span style={{ color: won ? "var(--green)" : "var(--text-secondary)" }}>
            {match.kc_score}
          </span>
          <span className="text-[var(--text-disabled)] mx-0.5">·</span>
          <span style={{ color: won ? "var(--text-secondary)" : "var(--red)" }}>
            {match.opp_score}
          </span>
        </p>

        {/* Date */}
        <p className="font-data text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
          {dateLabel}
        </p>

        {/* Derailed visual for losses : diagonal stripe overlay */}
        {!won && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-xl"
            style={{
              backgroundImage:
                "repeating-linear-gradient(135deg, transparent 0 10px, rgba(232,64,87,0.06) 10px 12px)",
            }}
          />
        )}
      </Link>
    </m.li>
  );
}

// ════════════════════════════════════════════════════════════════════
// Small UI atoms
// ════════════════════════════════════════════════════════════════════

function Pill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone: "hype" | "danger" | "neutral";
}) {
  const color =
    tone === "hype"
      ? "var(--green)"
      : tone === "danger"
        ? "var(--red)"
        : "var(--gold)";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border bg-[var(--bg-surface)] px-2.5 py-1 font-data text-[10px] font-bold uppercase tracking-widest tabular-nums"
      style={{
        borderColor: `${color}40`,
        color,
      }}
    >
      <span className="opacity-60">{label}</span>
      <span>{value}</span>
    </span>
  );
}
