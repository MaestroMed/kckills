/**
 * /vs/leaderboard — VS Roulette ELO leaderboard (Wave 30e / V64).
 *
 * The Postgres side has been ready since V59 (migration 059) with
 * `fn_top_elo_kills` + the `kill_elo` table. V64 (migration 064) adds
 * `fn_top_elo_kills_v2` with pagination + era + min_battles filters,
 * and `fn_elo_leaderboard_stats` for the sidebar.
 *
 * Server shell :
 *   1. Pre-fetches the first 50 rows with default filters (no role /
 *      no champion / no era / min_battles=5).
 *   2. Pre-fetches the sidebar stats blob (total battles + 3 featured
 *      kills).
 *   3. Pre-fetches the champion autocomplete list (distinct
 *      killer_champion across the top 200).
 *   4. Projects the static ERAS list into the era dropdown.
 *   5. Hands all four payloads to <VSLeaderboard /> client component.
 *
 * Cache strategy : revalidate=300 (5 min). The leaderboard moves slowly
 * (1 vote ≈ ±2 ELO) so a fresh SSR every five minutes is more than
 * enough. Filter changes happen client-side.
 */

import type { Metadata } from "next";
import Link from "next/link";

import { ERAS } from "@/lib/eras";
import {
  getEloLeaderboard,
  getEloStats,
  getLeaderboardChampions,
} from "@/lib/supabase/vs-leaderboard";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";

import { VSLeaderboard } from "@/components/vs-leaderboard/VSLeaderboard";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Classement ELO · KCKILLS",
  description:
    "Les kills KC les plus survotés par la communauté. Top 100 par score ELO calculé sur des milliers de duels.",
  alternates: { canonical: "/vs/leaderboard" },
  openGraph: {
    title: "Classement ELO — VS Roulette KC",
    description:
      "Les kills Karmine Corp les plus dominants de la VS Roulette. Filtre par rôle, champion, époque, et fais ta loi.",
    type: "website",
    url: "/vs/leaderboard",
    siteName: "KCKILLS",
    locale: "fr_FR",
  },
  twitter: {
    card: "summary_large_image",
    title: "Classement ELO — KCKILLS",
    description: "Les kills KC les plus survotés. Top 100 ELO.",
  },
};

export default async function VSLeaderboardPage() {
  // ─── Parallel pre-fetch ────────────────────────────────────────────
  const [initialRows, initialStats, champions] = await Promise.all([
    getEloLeaderboard({ limit: 50, offset: 0, minBattles: 5 }),
    getEloStats(),
    getLeaderboardChampions(),
  ]);

  const breadcrumb = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "VS Roulette", url: "/vs" },
    { name: "Classement", url: "/vs/leaderboard" },
  ]);

  return (
    <div
      className="-mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      <JsonLd data={breadcrumb} />

      {/* ─── Hero band ─────────────────────────────────────────────── */}
      <section
        className="relative overflow-hidden border-b border-[var(--border-gold)]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 30%, rgba(200,170,110,0.20) 0%, transparent 60%), linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-primary) 100%)",
        }}
      >
        {/* Scanline overlay */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
          }}
        />
        {/* Floating losanges */}
        <div
          aria-hidden
          className="absolute left-[6%] top-12 hidden md:block"
          style={{
            width: 16,
            height: 16,
            transform: "rotate(45deg)",
            background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
            opacity: 0.55,
            boxShadow: "0 0 22px rgba(200,170,110,0.5)",
          }}
        />
        <div
          aria-hidden
          className="absolute right-[8%] top-20 hidden md:block"
          style={{
            width: 10,
            height: 10,
            transform: "rotate(45deg)",
            background: "var(--cyan)",
            opacity: 0.4,
            boxShadow: "0 0 14px rgba(10,200,185,0.5)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-5xl px-5 pt-12 pb-12 md:pt-20 md:pb-16 text-center">
          <nav
            aria-label="Fil d'Ariane"
            className="mb-6 flex items-center justify-center gap-2 text-xs text-white/55"
          >
            <Link href="/" className="hover:text-[var(--gold)] transition-colors">
              Accueil
            </Link>
            <span aria-hidden className="text-white/25">
              ◆
            </span>
            <Link href="/vs" className="hover:text-[var(--gold)] transition-colors">
              VS Roulette
            </Link>
            <span aria-hidden className="text-white/25">
              ◆
            </span>
            <span className="text-[var(--gold)]">Classement</span>
          </nav>

          <p className="font-data text-[11px] uppercase tracking-[0.4em] text-[var(--gold)]/70 mb-3">
            Le verdict du Blue Wall
          </p>
          <h1
            className="font-display font-black tracking-tight leading-[0.85] text-4xl md:text-6xl lg:text-[7rem]"
            style={{
              color: "white",
              textShadow:
                "0 0 60px rgba(200,170,110,0.45), 0 6px 30px rgba(0,0,0,0.85)",
              letterSpacing: "-0.02em",
            }}
          >
            CLASSEMENT <span className="text-shimmer">ELO</span>
          </h1>
          <p className="mt-5 mx-auto max-w-2xl text-base md:text-lg text-white/80 font-medium">
            Les kills les plus survotés du VS Roulette ·{" "}
            <span className="text-[var(--gold-bright)]">
              ELO 1500 = base
            </span>
          </p>

          {/* Bilan strip */}
          <div className="mt-7 inline-flex items-center gap-4 md:gap-6 flex-wrap justify-center rounded-2xl border border-[var(--border-gold)] bg-black/30 backdrop-blur-md px-5 py-3">
            <Bilan
              label="Duels totaux"
              value={initialStats.total_battles.toLocaleString("fr-FR")}
            />
            <BilanSep />
            <Bilan
              label="Kills classés"
              value={initialStats.total_kills_with_battles.toLocaleString("fr-FR")}
              accent="var(--gold-bright)"
            />
            <BilanSep />
            <Bilan label="Seuil" value="≥ 5 batailles" small />
          </div>

          <div className="mt-7 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/vs"
              className="rounded-xl bg-[var(--gold)] px-6 py-3 font-display text-xs font-black uppercase tracking-[0.25em] text-[var(--bg-primary)] hover:bg-[var(--gold-bright)] hover:scale-[1.02] active:scale-95 transition-all"
              style={{
                boxShadow:
                  "0 14px 30px rgba(200,170,110,0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
              }}
            >
              Lance la roulette
            </Link>
            <Link
              href="/scroll"
              className="rounded-xl border border-white/25 bg-black/30 px-5 py-3 font-display text-xs font-bold uppercase tracking-[0.25em] text-white/75 hover:border-white/55 hover:text-white transition-all"
            >
              Mode scroll
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Body ──────────────────────────────────────────────────── */}
      <VSLeaderboard
        initialRows={initialRows}
        initialStats={initialStats}
        champions={champions}
        eras={ERAS}
      />

      {/* ─── Riot disclaimer ───────────────────────────────────────── */}
      <p
        aria-label="Riot Games disclaimer"
        className="px-4 py-6 text-center text-[9px] uppercase tracking-widest text-white/30"
      >
        Not endorsed by Riot Games. League of Legends © Riot Games.
      </p>
    </div>
  );
}

// ─── Hero bilan helpers ──────────────────────────────────────────────

function Bilan({
  label,
  value,
  accent,
  small,
}: {
  label: string;
  value: string;
  accent?: string;
  small?: boolean;
}) {
  return (
    <div className="text-left">
      <p
        className={`font-display font-black tabular-nums leading-none ${
          small ? "text-sm md:text-base" : "text-xl md:text-2xl"
        }`}
        style={{ color: accent ?? "var(--gold)" }}
      >
        {value}
      </p>
      <p className="font-data text-[9px] uppercase tracking-[0.25em] text-white/50 mt-1">
        {label}
      </p>
    </div>
  );
}

function BilanSep() {
  return (
    <span
      aria-hidden
      className="inline-block w-px h-7 self-center"
      style={{
        background:
          "linear-gradient(180deg, transparent, rgba(200,170,110,0.5), transparent)",
      }}
    />
  );
}
