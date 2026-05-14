"use client";

/**
 * PlayerSpotlight — Wave 32 hero card for the current top KC performer.
 *
 * Picks the best KC player over the past N matches (default 5) by a
 * weighted score :
 *
 *   score = kills*2.5 + assists*1.2 - deaths*1.5 + winRate*15
 *
 * Renders a cinematic side-by-side card :
 *
 *   ┌──────────────────────────────────────────────┐
 *   │   ┌──────────┐  PLAYER SPOTLIGHT             │
 *   │   │          │  ┌────────────────────────┐   │
 *   │   │  PHOTO   │  │ CALISTE        #4      │   │
 *   │   │          │  │ ADC · Roster 2026      │   │
 *   │   └──────────┘  └────────────────────────┘   │
 *   │                  ┌─────┬─────┬─────┬─────┐   │
 *   │                  │ 42  │ 5.1 │ Jhin│ 60% │   │
 *   │                  │KILLS│ KDA │CHAMP│ WR  │   │
 *   │                  └─────┴─────┴─────┴─────┘   │
 *   │                  → Voir son profil →         │
 *   └──────────────────────────────────────────────┘
 *
 * Mobile : photo above, stats below.
 *
 * Stats count up from 0 on scroll-into-view via AnimatedNumber.
 * Accessibility :
 *   - aria-label summarises the spotlight in plain French
 *   - prefers-reduced-motion : counters jump to final value
 *   - photo carries alt text with player name
 */

import { useMemo, useRef } from "react";
import Link from "next/link";
import Image from "next/image";
import { m, useInView, useReducedMotion } from "motion/react";

import type { RealMatch } from "@/lib/real-data";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { championSplashUrl, championIconUrl } from "@/lib/constants";
import { AnimatedNumber } from "@/components/AnimatedNumber";

interface Props {
  matches: RealMatch[];
  /** How many recent matches to weigh. Default 5 (Roster spotlight = last
   *  week and a bit of pro play). */
  windowSize?: number;
}

interface PlayerScore {
  name: string;
  role: string;
  kills: number;
  deaths: number;
  assists: number;
  games: number;
  wins: number;
  topChampion: string | null;
  champFreq: Record<string, number>;
  score: number;
}

const ROLE_LABEL: Record<string, string> = {
  top: "TOP",
  jungle: "JGL",
  mid: "MID",
  bottom: "ADC",
  adc: "ADC",
  support: "SUP",
};

const JERSEY_NUMBERS: Record<string, number> = {
  Canna: 1,
  Yike: 2,
  Kyeahoo: 3,
  kyeahoo: 3,
  Caliste: 4,
  Busio: 5,
};

function cleanName(name: string): string {
  return name.replace(/^(KC|KCB|G2|FNC|TH|GX|VIT|SK|MKOI|NAVI|BDS|SHFT|RGE|LR) /, "").trim();
}

function pickSpotlight(matches: RealMatch[], windowSize: number): PlayerScore | null {
  const recent = matches.slice(0, windowSize);
  if (recent.length === 0) return null;

  const tally: Record<string, PlayerScore> = {};

  for (const match of recent) {
    for (const game of match.games) {
      for (const p of game.kc_players) {
        if (!p.name.startsWith("KC ")) continue;
        const clean = cleanName(p.name);
        if (!tally[clean]) {
          tally[clean] = {
            name: clean,
            role: p.role,
            kills: 0,
            deaths: 0,
            assists: 0,
            games: 0,
            wins: 0,
            topChampion: null,
            champFreq: {},
            score: 0,
          };
        }
        const entry = tally[clean];
        entry.games += 1;
        entry.kills += p.kills;
        entry.deaths += p.deaths;
        entry.assists += p.assists;
        if (match.kc_won) entry.wins += 1;
        if (p.champion) {
          entry.champFreq[p.champion] = (entry.champFreq[p.champion] ?? 0) + 1;
        }
      }
    }
  }

  let best: PlayerScore | null = null;
  for (const entry of Object.values(tally)) {
    if (entry.games < 1) continue;
    const winRate = entry.games > 0 ? entry.wins / entry.games : 0;
    // Weighted score : reward kills + assists, penalise deaths, scale
    // winrate to a comparable magnitude.
    const score =
      entry.kills * 2.5 +
      entry.assists * 1.2 -
      entry.deaths * 1.5 +
      winRate * 15;
    entry.score = score;
    // Top champion = most-frequent pick in the window.
    let topChamp: string | null = null;
    let topFreq = 0;
    for (const [c, f] of Object.entries(entry.champFreq)) {
      if (f > topFreq) {
        topFreq = f;
        topChamp = c;
      }
    }
    entry.topChampion = topChamp;
    if (!best || score > best.score) best = entry;
  }
  return best;
}

export function PlayerSpotlight({ matches, windowSize = 5 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.25 });
  const reduced = useReducedMotion();

  const spotlight = useMemo(
    () => pickSpotlight(matches, windowSize),
    [matches, windowSize],
  );

  if (!spotlight) return null;

  const kda =
    spotlight.deaths > 0
      ? (spotlight.kills + spotlight.assists) / spotlight.deaths
      : spotlight.kills + spotlight.assists;
  const winRate =
    spotlight.games > 0
      ? Math.round((spotlight.wins / spotlight.games) * 100)
      : 0;
  const photo = PLAYER_PHOTOS[spotlight.name];
  const splash = spotlight.topChampion
    ? championSplashUrl(spotlight.topChampion)
    : null;
  const jersey = JERSEY_NUMBERS[spotlight.name];
  const roleLabel = ROLE_LABEL[spotlight.role] ?? spotlight.role.toUpperCase();

  return (
    <section
      ref={ref}
      className="relative max-w-7xl mx-auto px-4 md:px-6 py-12 md:py-16"
      aria-labelledby="player-spotlight-heading"
    >
      <header className="mb-6 md:mb-8">
        <p className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.35em] text-[var(--gold)]">
          Player Spotlight · {windowSize} dernières séries
        </p>
        <h2
          id="player-spotlight-heading"
          className="font-display text-3xl md:text-5xl font-black uppercase tracking-tight text-white mt-1"
        >
          Le <span className="text-gold-gradient">carry</span> du moment
        </h2>
      </header>

      <m.article
        initial={reduced ? false : { opacity: 0, y: 24 }}
        animate={inView ? { opacity: 1, y: 0 } : undefined}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        aria-label={`${spotlight.name}, ${roleLabel} — ${spotlight.kills} kills, ${kda.toFixed(1)} de KDA, ${winRate}% de winrate sur ${spotlight.games} games`}
        className="relative overflow-hidden rounded-3xl border-2 border-[var(--gold)]/40 bg-gradient-to-br from-[var(--bg-elevated)] via-[var(--bg-surface)] to-[var(--bg-primary)]"
        style={{
          boxShadow:
            "0 0 0 1px rgba(200,170,110,0.2), 0 30px 80px -30px rgba(200,170,110,0.5)",
        }}
      >
        {/* Background : champion splash blurred + dimmed */}
        {splash && (
          <div className="absolute inset-0 pointer-events-none">
            <Image
              src={splash}
              alt=""
              fill
              priority={false}
              sizes="(max-width: 1024px) 100vw, 1280px"
              className="object-cover object-top opacity-30"
              style={{ filter: "blur(8px) saturate(1.3) brightness(0.7)" }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)] via-[var(--bg-primary)]/70 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-transparent to-transparent" />
          </div>
        )}

        {/* Hextech corner accents */}
        <span
          aria-hidden
          className="absolute top-3 left-3 text-[var(--gold)] text-xl select-none"
        >
          ◆
        </span>
        <span
          aria-hidden
          className="absolute top-3 right-3 text-[var(--gold)] text-xl select-none"
        >
          ◆
        </span>

        <div className="relative grid gap-6 md:grid-cols-[260px_1fr] p-6 md:p-8">
          {/* Photo column */}
          <div className="flex md:block items-center gap-4">
            <m.div
              initial={reduced ? false : { scale: 0.92, opacity: 0 }}
              animate={inView ? { scale: 1, opacity: 1 } : undefined}
              transition={{ duration: 0.6, delay: 0.15 }}
              className="relative h-32 w-32 md:h-60 md:w-60 shrink-0 overflow-hidden rounded-2xl border-2 border-[var(--gold)]/60"
              style={{
                boxShadow:
                  "0 20px 60px -20px rgba(200,170,110,0.6), inset 0 0 0 1px rgba(200,170,110,0.3)",
              }}
            >
              {photo ? (
                <Image
                  src={photo}
                  alt={spotlight.name}
                  fill
                  sizes="(max-width: 768px) 128px, 240px"
                  className="object-cover"
                />
              ) : splash ? (
                <Image
                  src={splash}
                  alt={spotlight.name}
                  fill
                  sizes="(max-width: 768px) 128px, 240px"
                  className="object-cover object-top"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center font-display text-3xl font-black text-[var(--gold)]">
                  KC
                </div>
              )}
              {/* Jersey number badge */}
              {jersey && (
                <span
                  aria-hidden
                  className="absolute bottom-2 right-2 inline-flex h-9 w-9 md:h-12 md:w-12 items-center justify-center rounded-xl border border-[var(--gold)] bg-[var(--bg-primary)]/85 backdrop-blur-sm font-display text-xl md:text-2xl font-black text-[var(--gold)]"
                >
                  {jersey}
                </span>
              )}
            </m.div>

            {/* Mobile-only label sibling */}
            <div className="md:hidden flex-1 min-w-0">
              <h3 className="font-display text-2xl font-black uppercase truncate text-white">
                {spotlight.name}
              </h3>
              <p className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] mt-1">
                {roleLabel} · Roster {new Date().getUTCFullYear()}
              </p>
            </div>
          </div>

          {/* Content column */}
          <div className="flex flex-col">
            <div className="hidden md:block mb-4">
              <h3 className="font-display text-4xl lg:text-5xl font-black uppercase tracking-tight text-white">
                {spotlight.name}
              </h3>
              <p className="font-data text-xs uppercase tracking-widest text-[var(--text-muted)] mt-1">
                <span style={{ color: "var(--gold)" }}>{roleLabel}</span>
                <span className="mx-2 text-[var(--text-disabled)]">·</span>
                Roster Spring {new Date().getUTCFullYear()}
                {spotlight.topChampion && (
                  <>
                    <span className="mx-2 text-[var(--text-disabled)]">·</span>
                    <span style={{ color: "var(--text-secondary)" }}>
                      Champion fétiche : {spotlight.topChampion}
                    </span>
                  </>
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 md:gap-4">
              <StatTile
                label="Kills"
                value={spotlight.kills}
                tone="gold"
                inView={inView}
              />
              <StatTile
                label="KDA"
                value={Number(kda.toFixed(1))}
                tone="gold"
                format="decimal1"
                inView={inView}
              />
              <StatTile
                label="Games"
                value={spotlight.games}
                tone="neutral"
                inView={inView}
              />
              <StatTile
                label="Winrate"
                value={winRate}
                tone={winRate >= 60 ? "win" : winRate >= 40 ? "neutral" : "loss"}
                format="percent0"
                inView={inView}
              />
            </div>

            {/* Top champion mini-strip */}
            {spotlight.topChampion && (
              <div className="mt-5 flex items-center gap-3">
                <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)] shrink-0">
                  Champion fétiche
                </span>
                <span className="relative h-7 w-7 md:h-8 md:w-8 rounded-md overflow-hidden border border-[var(--gold)]/40 shrink-0">
                  <Image
                    src={championIconUrl(spotlight.topChampion)}
                    alt=""
                    fill
                    sizes="32px"
                    className="object-cover"
                  />
                </span>
                <span className="font-display text-sm md:text-base font-bold text-white truncate">
                  {spotlight.topChampion}
                </span>
                <span className="ml-auto font-data text-[10px] text-[var(--text-muted)] tabular-nums">
                  {spotlight.champFreq[spotlight.topChampion]} ×
                </span>
              </div>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link
                href={`/player/${encodeURIComponent(spotlight.name)}`}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--gold)] bg-[var(--gold)]/15 px-5 py-2.5 font-display text-xs font-black uppercase tracking-widest text-[var(--gold)] hover:bg-[var(--gold)]/25 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
              >
                Voir son profil
                <span aria-hidden>→</span>
              </Link>
              <Link
                href={`/scroll?killerPlayer=${encodeURIComponent(spotlight.name)}`}
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-5 py-2.5 font-display text-xs font-bold uppercase tracking-widest text-[var(--text-secondary)] hover:border-[var(--gold)]/50 hover:text-[var(--gold)] transition-colors"
              >
                Scroll ses kills
                <span aria-hidden>→</span>
              </Link>
            </div>
          </div>
        </div>
      </m.article>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// StatTile
// ════════════════════════════════════════════════════════════════════

function StatTile({
  label,
  value,
  tone,
  format = "integer",
  inView,
}: {
  label: string;
  value: number;
  tone: "gold" | "win" | "loss" | "neutral";
  format?: "integer" | "decimal1" | "percent0";
  inView: boolean;
}) {
  const color =
    tone === "gold"
      ? "var(--gold)"
      : tone === "win"
        ? "var(--green)"
        : tone === "loss"
          ? "var(--red)"
          : "var(--text-primary)";

  return (
    <div
      className="rounded-xl border bg-[var(--bg-surface)]/70 backdrop-blur-sm p-3 md:p-4"
      style={{ borderColor: `${color === "var(--text-primary)" ? "var(--border-gold)" : color}40` }}
    >
      <p className="text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
      <p
        className="font-data text-2xl md:text-3xl font-black tabular-nums mt-1"
        style={{ color }}
      >
        {inView ? (
          <AnimatedNumber value={value} format={format} duration={1.4} />
        ) : (
          <span>0</span>
        )}
      </p>
    </div>
  );
}
