"use client";

/**
 * ViShowcase — Karmine Corp's signature champion: Vi.
 *
 * Replaces the old "Train Vi" momentum tracker (which had nothing to do
 * with the champion and read as "games where Yike plays Vi"). This is the
 * real thing the section was always meant to be: a showcase of KC's best
 * plays ON Vi, the redemption-arc narrative (couldn't win on her → now
 * Yike is near-unbeatable), and a browsable history of every Vi clip.
 *
 * Data : getViShowcase() — real catalog (clips, clipCount, topScore,
 * multiKills). The WINRATE is editorial (game_participants has no Vi rows
 * to compute it from) — see YIKE_VI_WINRATE below.
 *
 * Background : Riot's official Vi splash via championSplashUrl — used under
 * Riot's "Legal Jibber Jabber" fan-content policy (disclaimer site-wide).
 *
 * Accent : --cyan (hextech / Vi's gauntlets) to set it apart from the
 * gold sections around it.
 */

import Link from "next/link";
import Image from "next/image";
import { m, useReducedMotion } from "motion/react";

import { championIconUrl, championSplashUrl } from "@/lib/constants";
import type { PublishedKillRow, ViShowcaseData } from "@/lib/supabase/kills";
import { useT } from "@/lib/i18n/use-lang";

/**
 * FALLBACK Vi stats — used only until player_champion_stats (migration 082)
 * has been backfilled by worker/scripts/backfill_player_champion_stats.py.
 * Once it has, the live DB values (yikeViCareer / yikeViRecent props) win.
 * Sourced from gol.gg / Leaguepedia (Yike) on 2026-06-13. Refresh protocol:
 * .claude/skills/esports-data-retrieval.
 */
const VI_STATS = {
  recentWinrate: 90.9, // LEC Spring 2026
  recentGames: 11,
  recentKda: 6.3,
  careerGames: 52, // Vi = Yike's #1 most-played champion (tied)
  careerWinrate: 63.5,
  careerKda: 3.4,
};

const CYAN = "var(--cyan)";

export function ViShowcase({
  clips,
  clipCount,
  topScore,
  multiKills,
  yikeViCareer,
  yikeViRecent,
}: ViShowcaseData) {
  const reduced = useReducedMotion();
  const t = useT();
  if (clips.length === 0) return null;

  // Prefer live DB stats (player_champion_stats); fall back to the sourced
  // constant until the worker backfill has run.
  const career = yikeViCareer ?? {
    games: VI_STATS.careerGames,
    winrate: VI_STATS.careerWinrate,
    kda: VI_STATS.careerKda,
  };
  const recent = yikeViRecent ?? {
    games: VI_STATS.recentGames,
    winrate: VI_STATS.recentWinrate,
    kda: VI_STATS.recentKda,
  };
  const recentLabel = yikeViRecent ? t("p_vi.label_2026") : t("p_vi.label_spring");

  const splash = championSplashUrl("Vi", 0);
  const enter = (i: number) =>
    reduced
      ? { initial: false as const, animate: { opacity: 1, y: 0 } }
      : {
          initial: { opacity: 0, y: 24 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, margin: "-80px" },
          transition: { duration: 0.5, ease: [0.16, 1, 0.3, 1] as const, delay: i * 0.06 },
        };

  return (
    <section className="relative max-w-7xl mx-auto px-4 md:px-6 py-12 md:py-16">
      <div
        className="relative overflow-hidden rounded-[var(--stage-radius,18px)] border"
        style={{
          borderColor: "rgba(10,200,185,0.22)",
          boxShadow: "0 0 0 1px rgba(10,200,185,0.06), 0 30px 80px -40px rgba(10,200,185,0.4)",
        }}
      >
        {/* ─── Vi splash background ─────────────────────────────────── */}
        <div aria-hidden className="absolute inset-0">
          <Image
            src={splash}
            alt=""
            fill
            priority={false}
            sizes="(max-width: 768px) 100vw, 1280px"
            className="object-cover object-[72%_18%] md:object-[78%_22%] opacity-70"
          />
          {/* Left-to-right legibility wash (content sits on the dark left) */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(90deg, var(--bg-primary) 0%, rgba(1,10,19,0.96) 30%, rgba(1,10,19,0.65) 55%, rgba(1,10,19,0.15) 100%)",
            }}
          />
          {/* Bottom darken so the clip strip stays readable */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(0deg, var(--bg-primary) 2%, rgba(1,10,19,0.4) 38%, transparent 70%)",
            }}
          />
          {/* Cyan hextech glow, top-left */}
          <div
            className="absolute -top-24 -left-24 h-72 w-72 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, rgba(10,200,185,0.18), transparent 70%)" }}
          />
        </div>

        {/* ─── Content ──────────────────────────────────────────────── */}
        <div className="relative p-6 md:p-10">
          {/* Eyebrow */}
          <m.p
            {...enter(0)}
            className="font-data text-[10px] md:text-[11px] uppercase tracking-[0.35em] font-bold"
            style={{ color: CYAN }}
          >
            {t("p_vi.eyebrow")}
          </m.p>

          {/* Title + winrate */}
          <m.div {...enter(1)} className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
            <h2 className="font-display text-6xl md:text-8xl font-black uppercase leading-[0.85] text-white">
              <span
                style={{
                  color: CYAN,
                  textShadow: "0 0 50px rgba(10,200,185,0.55), 0 0 14px rgba(10,200,185,0.4)",
                }}
              >
                Vi
              </span>
            </h2>

            {/* Hero stat — the winrate */}
            <div className="flex items-end gap-2 pb-1">
              <span
                className="font-data text-5xl md:text-6xl font-black tabular-nums leading-none"
                style={{ color: CYAN, textShadow: "0 0 40px rgba(10,200,185,0.5)" }}
              >
                {recent.winrate}%
              </span>
              <span className="mb-1 font-display text-[10px] md:text-xs font-bold uppercase tracking-[0.2em] text-[var(--text-secondary)]">
                {t("p_vi.winrate")}
                <br />
                {recentLabel}
              </span>
            </div>
          </m.div>

          {/* Narrative */}
          <m.p
            {...enter(2)}
            className="mt-4 max-w-xl text-sm md:text-base leading-relaxed text-[var(--text-secondary)]"
          >
            {t("p_vi.narrative", {
              career: career.games,
              recent: recent.games,
              wr: recent.winrate,
              kda: recent.kda,
            })}
          </m.p>

          {/* Real-data stat pills */}
          <m.div {...enter(3)} className="mt-5 flex flex-wrap items-center gap-2">
            <Pill value={career.games} label={t("p_vi.pill_career")} />
            <Pill value={recent.kda} label={t("p_vi.pill_kda")} />
            <Pill value={clipCount} label={t("p_vi.pill_highlights")} />
            {topScore !== null && <Pill value={`${topScore.toFixed(1)}`} label={t("p_vi.pill_score")} suffix="/10" />}
            {multiKills > 0 && <Pill value={multiKills} label={t("p_vi.pill_multikills")} />}
          </m.div>

          {/* ─── Clip strip ─────────────────────────────────────────── */}
          <div className="mt-7">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-white/80">
                {t("p_vi.strip_heading")}
              </span>
              <Link
                href="/champion/Vi"
                className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors"
                style={{ color: CYAN }}
              >
                {t("p_vi.cta")} <span aria-hidden>→</span>
              </Link>
            </div>

            <ol
              role="list"
              aria-label={t("p_vi.strip_aria")}
              className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory -mx-2 px-2"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {clips.map((clip, idx) => (
                <ViClip key={clip.id} clip={clip} index={idx} reduced={!!reduced} />
              ))}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

// ════════════════════════════════════════════════════════════════════
// Clip card
// ════════════════════════════════════════════════════════════════════

function ViClip({
  clip,
  index,
  reduced,
}: {
  clip: PublishedKillRow;
  index: number;
  reduced: boolean;
}) {
  const t = useT();
  return (
    <m.li
      role="listitem"
      initial={reduced ? false : { opacity: 0, x: 30 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1], delay: reduced ? 0 : 0.2 + index * 0.05 }}
      className="shrink-0 snap-start"
    >
      <Link
        href={`/scroll?kill=${clip.id}`}
        className="group relative block aspect-[9/16] w-28 md:w-32 overflow-hidden rounded-xl border bg-[var(--bg-surface)] transition-all hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--cyan)]"
        style={{ borderColor: "rgba(10,200,185,0.25)" }}
        aria-label={
          clip.highlight_score !== null
            ? t("p_vi.clip_aria_scored", {
                victim: clip.victim_champion ?? "?",
                n: clip.highlight_score.toFixed(1),
              })
            : t("p_vi.clip_aria", { victim: clip.victim_champion ?? "?" })
        }
      >
        {clip.thumbnail_url && (
          <Image
            src={clip.thumbnail_url}
            alt=""
            fill
            sizes="(max-width: 768px) 112px, 128px"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}

        {/* Score badge */}
        {clip.highlight_score !== null && (
          <span
            className="absolute top-1.5 right-1.5 z-10 rounded bg-black/75 px-1.5 py-0.5 font-data text-[9px] font-black tabular-nums backdrop-blur-sm"
            style={{ color: CYAN }}
          >
            {clip.highlight_score.toFixed(1)}
          </span>
        )}

        {/* Multi-kill badge */}
        {clip.multi_kill && (
          <span className="absolute top-1.5 left-1.5 z-10 rounded bg-[var(--orange)]/90 px-1.5 py-0.5 text-[8px] font-black uppercase text-black">
            {clip.multi_kill}
          </span>
        )}

        {/* Bottom: Vi → victim */}
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-1 bg-gradient-to-t from-black/95 to-transparent p-1.5">
          <Image
            src={championIconUrl("Vi")}
            alt=""
            width={20}
            height={20}
            className="rounded border"
            style={{ borderColor: "rgba(10,200,185,0.6)" }}
          />
          <span aria-hidden className="text-[9px]" style={{ color: CYAN }}>
            →
          </span>
          <Image
            src={championIconUrl(clip.victim_champion ?? "Aatrox")}
            alt=""
            width={16}
            height={16}
            className="rounded border border-white/20 opacity-80"
          />
        </div>
      </Link>
    </m.li>
  );
}

// ════════════════════════════════════════════════════════════════════
// Stat pill
// ════════════════════════════════════════════════════════════════════

function Pill({
  value,
  label,
  suffix,
}: {
  value: number | string;
  label: string;
  suffix?: string;
}) {
  return (
    <span
      className="inline-flex items-baseline gap-1.5 rounded-full border bg-black/30 px-3 py-1.5 backdrop-blur-sm"
      style={{ borderColor: "rgba(10,200,185,0.3)" }}
    >
      <span className="font-data text-sm font-black tabular-nums text-white">
        {value}
        {suffix && <span className="text-[var(--text-muted)]">{suffix}</span>}
      </span>
      <span className="font-data text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </span>
    </span>
  );
}
