/**
 * HeroLiveStats — async server component for the homepage hero RIGHT column.
 *
 * Wave 13h (2026-05-07) — extracted from `app/page.tsx` so the hero's left
 * column (title shimmer + CTAs + roster pills) can stream into the
 * static shell IMMEDIATELY, without waiting on the Supabase queries that
 * feed the right-column cards. Wrapped in
 * <Suspense fallback={<HeroLiveStatsSkeleton />}> : zero CLS.
 *
 * 2026-09-24 — accueil « clips d'abord » (KCKILLS est un site de clips,
 * pas de stats) : le clip de la semaine prend la place des cartes
 * « carrière » (kills, V/D, winrate) et « top scorer ». Restent le dernier
 * match, en compact, et une ligne catalogue qui mène à tous les clips.
 */

import Link from "next/link";
import Image from "next/image";
import { getStaticT } from "@/lib/i18n/server-lang";
import { type RealData } from "@/lib/real-data";
import { TEAM_LOGOS, KC_LOGO } from "@/lib/kc-assets";
import {
  getCachedHeroLastMatch as getHeroLastMatch,
  getCachedPublishedKcKillCount as getPublishedKcKillCount,
} from "@/lib/supabase/hero-stats-cached";
import { HeroClip } from "@/components/home/HeroClip";

interface HeroLiveStatsProps {
  allMatches: RealData["matches"];
}

const CATALOG_YEAR_START = 2021;

export async function HeroLiveStats({ allMatches }: HeroLiveStatsProps) {
  // `getStaticT()` et non `getServerT()` : ce dernier lit cookies() +
  // headers() et fait sortir la page hôte du pré-rendu.
  const { t } = getStaticT();
  const [clipCount, liveLastMatch, heroClip] = await Promise.all([
    getPublishedKcKillCount(),
    getHeroLastMatch(),
    HeroClip(),
  ]);

  const lastMatch = liveLastMatch
    ? {
        id: liveLastMatch.externalId ?? liveLastMatch.matchId,
        date: liveLastMatch.scheduledAt,
        opponent: liveLastMatch.opponent,
        kc_score: liveLastMatch.kcScore,
        opp_score: liveLastMatch.oppScore,
        kc_won: liveLastMatch.kcWon,
        stage: liveLastMatch.stage ?? "Saison",
        best_of: liveLastMatch.bestOf,
      }
    : allMatches[0] ?? null;

  return (
    // lg:max-w-7xl (page) + lg:mr-8 : le clip reste à gauche de l'étendard KC
    // qui pend sous le coin droit de la barre (sinon il en masquait le coin).
    <div className="md:col-span-5 lg:col-span-6 flex flex-col gap-3 w-full max-w-sm md:ml-auto lg:mr-8">
      {heroClip}

      {lastMatch && (() => {
        const oppLogo = TEAM_LOGOS[lastMatch.opponent.code];
        const date = new Date(lastMatch.date);
        return (
          <Link
            href={`/match/${lastMatch.id}`}
            className="group flex items-center gap-3 rounded-xl bg-black/55 backdrop-blur-md border border-[var(--gold)]/20 px-4 py-3 transition-all hover:border-[var(--gold)]/50 hover:bg-black/70"
          >
            <div className="flex flex-col">
              <span className="font-data text-[9px] uppercase tracking-[0.25em] text-[var(--gold)]/70">
                {t("p_home.last_match")}
              </span>
              <span className="font-data text-[10px] text-white/60">
                {date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} &middot; {lastMatch.stage}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Image src={KC_LOGO} alt="KC" width={24} height={24} className="rounded" />
              <span className="font-data text-lg font-black tabular-nums">
                <span className={lastMatch.kc_won ? "text-[var(--green)]" : "text-white/70"}>{lastMatch.kc_score}</span>
                <span className="text-white/30 mx-1">-</span>
                <span className={!lastMatch.kc_won ? "text-[color-mix(in_srgb,var(--red)_75%,white)]" : "text-white/70"}>{lastMatch.opp_score}</span>
              </span>
              {oppLogo ? (
                <Image src={oppLogo} alt={lastMatch.opponent.code} width={24} height={24} className="rounded" />
              ) : (
                <span className="font-data text-xs font-bold">{lastMatch.opponent.code}</span>
              )}
            </div>
          </Link>
        );
      })()}

      {clipCount > 0 && (
        <Link
          href="/clips"
          className="self-center md:self-end font-data text-[10px] uppercase tracking-[0.25em] text-white/70 hover:text-[var(--gold)] transition-colors"
        >
          {t("p_home.hero_catalog", {
            clips: clipCount.toLocaleString("fr-FR"),
            from: CATALOG_YEAR_START,
            to: new Date().getUTCFullYear(),
          })}{" "}
          &rarr;
        </Link>
      )}
    </div>
  );
}

/**
 * Skeleton — mêmes dimensions que les cartes réelles (clip : 9:16 étroit sur
 * mobile, 4:5 pleine largeur au-delà de md ; dernier match ~60 px) pour
 * zéro CLS quand les données arrivent.
 */
export function HeroLiveStatsSkeleton() {
  return (
    <div
      className="md:col-span-5 lg:col-span-6 flex flex-col gap-3 w-full max-w-sm md:ml-auto lg:mr-8"
      aria-hidden="true"
    >
      <div className="rounded-2xl bg-black/55 border border-[var(--gold)]/20 h-[199px] md:h-auto md:aspect-[4/5] animate-pulse" />
      <div className="rounded-xl bg-black/55 border border-[var(--gold)]/20 h-[60px] animate-pulse" />
    </div>
  );
}
