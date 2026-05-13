"use client";

/**
 * /vs/leaderboard — top-3 cinematic podium.
 *
 * Three columns, centre column raised highest. Each podium kill renders
 * as a 9:16 thumbnail tile with :
 *   - rank chip (1 / 2 / 3) with gold/silver/bronze rim
 *   - ELO score chip
 *   - matchup line (killer → victim, champion fallback)
 *   - small CTA "Voir le clip" → /scroll?kill=<id>
 *
 * Mobile : the three columns stack vertically, the gold #1 staying on
 * top, silver in the middle, bronze at the bottom — keeping the
 * podium hierarchy clear without the visual gymnastics of a wide layout.
 *
 * Animations : stagger-fade entrance + 1st-place subtle pulse, both
 * gated on prefers-reduced-motion.
 */

import Link from "next/link";
import Image from "next/image";
import { m, useReducedMotion } from "motion/react";

import { championLoadingUrl } from "@/lib/constants";
import { winRatePct } from "@/lib/vs-roulette";
import type { EloLeaderboardRow } from "@/lib/supabase/vs-leaderboard";

interface PodiumProps {
  kills: EloLeaderboardRow[]; // top 3 (or fewer)
}

const RANK_META = [
  {
    rim: "linear-gradient(135deg, #F0E6D2, #C8AA6E, #785A28)",
    rimGlow: "rgba(240,230,210,0.55)",
    crown: "👑",
    accent: "#C8AA6E",
    bg: "rgba(200,170,110,0.12)",
    label: "1ère place",
    short: "1",
  },
  {
    rim: "linear-gradient(135deg, #E5E7EB, #9CA3AF, #4B5563)",
    rimGlow: "rgba(229,231,235,0.4)",
    crown: "🥈",
    accent: "#D1D5DB",
    bg: "rgba(209,213,219,0.08)",
    label: "2e place",
    short: "2",
  },
  {
    rim: "linear-gradient(135deg, #D97757, #A85B3E, #6B3A26)",
    rimGlow: "rgba(217,119,87,0.4)",
    crown: "🥉",
    accent: "#E18A6A",
    bg: "rgba(217,119,87,0.10)",
    label: "3e place",
    short: "3",
  },
] as const;

export function Podium({ kills }: PodiumProps) {
  const prefersReducedMotion = useReducedMotion();

  if (kills.length === 0) return null;

  // We always want positions in fixed order : 2nd, 1st, 3rd on desktop
  // (so 1st visually stands in the middle, raised). On mobile we stack
  // 1, 2, 3 vertically.
  const podium = [kills[0] ?? null, kills[1] ?? null, kills[2] ?? null];

  return (
    <section
      aria-label="Top 3 du classement ELO"
      className="mx-auto max-w-5xl px-4 pt-8 md:pt-12 pb-2"
    >
      {/* Desktop : three columns, 1st in centre raised */}
      <div className="hidden md:grid md:grid-cols-3 md:items-end md:gap-5 lg:gap-8">
        {/* 2nd */}
        {podium[1] && (
          <PodiumColumn
            kill={podium[1]}
            rank={1}
            raised={false}
            prefersReducedMotion={prefersReducedMotion ?? false}
            delay={0.15}
          />
        )}
        {/* 1st */}
        {podium[0] && (
          <PodiumColumn
            kill={podium[0]}
            rank={0}
            raised
            prefersReducedMotion={prefersReducedMotion ?? false}
            delay={0}
          />
        )}
        {/* 3rd */}
        {podium[2] && (
          <PodiumColumn
            kill={podium[2]}
            rank={2}
            raised={false}
            prefersReducedMotion={prefersReducedMotion ?? false}
            delay={0.3}
          />
        )}
      </div>

      {/* Mobile : stack 1 → 2 → 3 vertically */}
      <div className="md:hidden flex flex-col gap-4">
        {podium.map((k, i) =>
          k ? (
            <PodiumColumn
              key={k.kill_id}
              kill={k}
              rank={i as 0 | 1 | 2}
              raised={false}
              mobile
              prefersReducedMotion={prefersReducedMotion ?? false}
              delay={i * 0.12}
            />
          ) : null,
        )}
      </div>

      {/* Podium baseline (decorative gold gradient bar under the cards) */}
      <div
        aria-hidden
        className="hidden md:block mt-4 h-px max-w-3xl mx-auto"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(200,170,110,0.5) 30%, rgba(240,230,210,0.85) 50%, rgba(200,170,110,0.5) 70%, transparent)",
        }}
      />
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// One podium column
// ════════════════════════════════════════════════════════════════════

function PodiumColumn({
  kill,
  rank,
  raised,
  prefersReducedMotion,
  delay,
  mobile,
}: {
  kill: EloLeaderboardRow;
  rank: 0 | 1 | 2;
  raised: boolean;
  prefersReducedMotion: boolean;
  delay: number;
  mobile?: boolean;
}) {
  const meta = RANK_META[rank];
  const killerName = kill.killer_name ?? kill.killer_champion ?? "?";
  const victimName = kill.victim_name ?? kill.victim_champion ?? "?";
  const wr = winRatePct(kill.wins, kill.battles_count);

  const fallbackArt = kill.killer_champion
    ? championLoadingUrl(kill.killer_champion)
    : null;
  const poster = kill.thumbnail_url ?? fallbackArt;

  const scale = mobile ? 1 : raised ? 1.08 : 0.94;

  return (
    <m.div
      initial={
        prefersReducedMotion
          ? false
          : { opacity: 0, y: 28, scale: scale * 0.92 }
      }
      animate={{ opacity: 1, y: 0, scale }}
      transition={{
        duration: 0.6,
        delay: prefersReducedMotion ? 0 : delay,
        ease: [0.16, 1, 0.3, 1],
      }}
      className="relative"
      style={{ transformOrigin: "bottom center" }}
    >
      <Link
        href={`/scroll?kill=${kill.kill_id}`}
        aria-label={`Lire le clip rang ${meta.short} : ${killerName} contre ${victimName}, ${Math.round(kill.elo_rating)} ELO`}
        className="group relative block rounded-2xl overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--gold)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]"
        style={{
          aspectRatio: mobile ? "16 / 9" : "9 / 16",
          background: `linear-gradient(180deg, ${meta.bg}, transparent), var(--bg-surface)`,
          boxShadow: raised
            ? `0 30px 70px rgba(0,0,0,0.6), 0 0 0 2px rgba(0,0,0,0.5), 0 0 0 3px ${meta.accent}, 0 0 80px ${meta.rimGlow}`
            : `0 18px 40px rgba(0,0,0,0.45), 0 0 0 2px rgba(0,0,0,0.5), 0 0 0 3px ${meta.accent}55, 0 0 40px ${meta.rimGlow}`,
        }}
      >
        {/* Background art / thumbnail */}
        {poster ? (
          <Image
            src={poster}
            alt=""
            fill
            sizes={mobile ? "100vw" : "(max-width: 1024px) 33vw, 30vw"}
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            priority={rank === 0}
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[var(--bg-elevated)] to-[var(--bg-surface)]">
            <span className="font-display text-5xl text-[var(--gold-dark)]">KC</span>
          </div>
        )}

        {/* Top gradient + losange corners */}
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-black/65 via-black/15 to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black via-black/70 to-transparent pointer-events-none" />

        {/* Rank crown + chip */}
        <div className="absolute top-3 left-3 flex items-center gap-2">
          <span
            aria-hidden
            className="inline-flex items-center justify-center rounded-full font-display font-black text-base"
            style={{
              width: rank === 0 ? 44 : 38,
              height: rank === 0 ? 44 : 38,
              background: meta.rim,
              color: "var(--bg-primary)",
              boxShadow: `0 0 22px ${meta.rimGlow}, inset 0 1px 0 rgba(255,255,255,0.4)`,
            }}
          >
            {meta.short}
          </span>
          {rank === 0 && (
            <m.span
              aria-hidden
              animate={
                prefersReducedMotion
                  ? undefined
                  : { y: [0, -3, 0], rotate: [-6, 6, -6] }
              }
              transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
              className="text-2xl"
              style={{
                filter: "drop-shadow(0 0 12px rgba(240,230,210,0.6))",
              }}
            >
              {meta.crown}
            </m.span>
          )}
        </div>

        {/* ELO chip top-right */}
        <div className="absolute top-3 right-3 flex flex-col items-end gap-1">
          <span
            className="rounded-md backdrop-blur-md px-2 py-0.5 font-data text-[11px] font-black tabular-nums"
            style={{
              background: "rgba(0,0,0,0.7)",
              color: meta.accent,
              border: `1px solid ${meta.accent}66`,
              boxShadow: `0 6px 16px ${meta.rimGlow}`,
            }}
          >
            ELO {Math.round(kill.elo_rating)}
          </span>
          {kill.multi_kill ? (
            <span className="rounded-md bg-[var(--orange)]/25 border border-[var(--orange)]/45 backdrop-blur-md px-1.5 py-0.5 font-data text-[9px] font-bold uppercase tracking-widest text-[var(--orange)]">
              {kill.multi_kill}
            </span>
          ) : null}
        </div>

        {/* Bottom info — matchup + stats */}
        <div className="absolute inset-x-0 bottom-0 z-[5] p-4">
          <p className="font-data text-[9px] uppercase tracking-[0.3em] text-[var(--gold)]/85 mb-1">
            {meta.label}
          </p>
          <h3
            className="font-display text-lg md:text-xl font-black leading-tight line-clamp-2"
            style={{
              color: rank === 0 ? "var(--gold-bright)" : "white",
              textShadow: "0 2px 10px rgba(0,0,0,0.85)",
            }}
          >
            <span style={{ color: meta.accent }}>{killerName}</span>{" "}
            <span className="text-white/75">→ {victimName}</span>
          </h3>
          <p className="mt-0.5 font-data text-[10px] uppercase tracking-widest text-white/55 truncate">
            {kill.killer_champion ?? "?"} vs {kill.victim_champion ?? "?"}
          </p>
          {kill.ai_description && rank === 0 && (
            <p className="mt-2 text-[11px] text-white/70 line-clamp-2 leading-snug">
              {kill.ai_description}
            </p>
          )}

          <div className="mt-3 flex items-center gap-2.5 flex-wrap">
            <Stat label="Battles" value={String(kill.battles_count)} accent={meta.accent} />
            <Stat label="WR" value={`${wr}%`} accent={meta.accent} />
            {kill.highlight_score != null && (
              <Stat label="IA" value={kill.highlight_score.toFixed(1)} accent={meta.accent} />
            )}
          </div>
        </div>

        {/* Corner losanges */}
        <CornerLosange position="tl" color={meta.accent} />
        <CornerLosange position="br" color={meta.accent} />
      </Link>
    </m.div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-black/55 backdrop-blur-md px-1.5 py-0.5 border border-white/10">
      <span className="font-data text-[8px] uppercase tracking-[0.25em] text-white/55">
        {label}
      </span>
      <span
        className="font-data text-[11px] font-black tabular-nums"
        style={{ color: accent }}
      >
        {value}
      </span>
    </span>
  );
}

function CornerLosange({
  position,
  color,
}: {
  position: "tl" | "tr" | "bl" | "br";
  color: string;
}) {
  const map: Record<string, string> = {
    tl: "top-2 left-2",
    tr: "top-2 right-2",
    bl: "bottom-2 left-2",
    br: "bottom-2 right-2",
  };
  return (
    <span
      aria-hidden
      className={`absolute ${map[position]} pointer-events-none`}
      style={{
        width: 9,
        height: 9,
        transform: "rotate(45deg)",
        background: `linear-gradient(135deg, ${color}, ${color}88)`,
        boxShadow: `0 0 10px ${color}88`,
      }}
    />
  );
}
