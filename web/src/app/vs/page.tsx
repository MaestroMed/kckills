/**
 * /vs — VS Roulette server shell.
 *
 * Wave 25.3 (V59). The /vs page is a two-column cascaded-filter kill-vs-kill
 * voting game backed by migration 059's three RPCs (fn_pick_vs_pair,
 * fn_record_vs_vote, fn_top_elo_kills).
 *
 * This server component does the minimum amount of work :
 *   1. Resolve the KC tracked roster (used by the player + role dropdowns).
 *   2. Pull a slim list of distinct killer champions from published kills
 *      so the champion dropdown can autocomplete without a giant DD-tragon
 *      bundle.
 *   3. Project the static KC eras into VSEraOption[] (no DB read).
 *   4. Pull 8-12 thumbnail URLs that the client component cycles through
 *      during the slot-machine roulette animation. We pre-fetch them
 *      server-side so the FIRST spin is glitch-free (no thumb-pop on
 *      empty placeholders).
 *
 * Every below-the-fold work is delegated to the client `<VSRoulette />`
 * which talks to Supabase directly via `createClient()` (browser).
 *
 * Cache strategy : revalidate=1800 (30 min). The page payload barely
 * changes — only the roster + champion list, both effectively static
 * between matches. The roulette pair itself is fetched client-side
 * on demand, so ISR doesn't stale it.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ERAS } from "@/lib/eras";
import { getTrackedRoster } from "@/lib/supabase/players";
import { getPublishedKills } from "@/lib/supabase/kills";
import {
  buildEraOptions,
  type VSPlayerOption,
} from "@/lib/vs-roulette";

import { VSRoulette } from "@/components/VSRoulette";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";

export const revalidate = 1800;

export const metadata: Metadata = {
  title: "VS Roulette — KCKILLS",
  description:
    "Vote pour le meilleur kill Karmine Corp. Filtre par joueur, champion, époque, type de kill — la roulette pioche deux clips, à toi de trancher. ELO communautaire en temps réel.",
  alternates: { canonical: "/vs" },
  openGraph: {
    title: "VS Roulette — Vote le meilleur kill KC",
    description:
      "Deux clips. Un vote. Une roulette KC façon slot-machine hextech. À toi de couronner le meilleur kill Karmine Corp.",
    type: "website",
    url: "/vs",
    siteName: "KCKILLS",
    locale: "fr_FR",
    images: [
      {
        url: "/images/hero-bg.jpg",
        width: 1920,
        height: 1280,
        alt: "VS Roulette — KCKILLS",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VS Roulette — KCKILLS",
    description: "Deux clips. Un vote. La roulette des kills KC.",
    images: ["/images/hero-bg.jpg"],
  },
};

/**
 * Build the per-player option list. We rely on the same RLS-friendly
 * helper the homepage uses for the roster pills.
 */
async function buildPlayerOptions(): Promise<VSPlayerOption[]> {
  const roster = await getTrackedRoster();
  // Slug = ign verbatim (case-insensitive match on the SQL side).
  return roster
    .filter((r) => r.ign && r.ign !== "?")
    .map((r) => ({
      ign: r.ign,
      role: r.role,
      slug: r.ign,
    }))
    .sort((a, b) => a.ign.localeCompare(b.ign));
}

/**
 * Build the champion dropdown options + the roulette animation thumbnail
 * pool from a single Supabase fetch.
 *
 * One round-trip → two derived datasets. The kills query is already
 * React-cached by getPublishedKills() so this doesn't double-bill egress
 * if /scroll happens to share the cache key in the same render pass.
 */
async function buildChampionsAndThumbnails(): Promise<{
  champions: string[];
  rouletteThumbnails: string[];
}> {
  // 80 kills covers every KC-played champion in the current meta
  // (~30 unique champions in /scroll) plus a healthy pool of vertical
  // thumbnails for the roulette animation.
  const kills = await getPublishedKills(80);
  const seenChamps = new Set<string>();
  const champions: string[] = [];
  const rouletteThumbnails: string[] = [];
  for (const k of kills) {
    if (k.killer_champion && !seenChamps.has(k.killer_champion)) {
      seenChamps.add(k.killer_champion);
      champions.push(k.killer_champion);
    }
    if (k.thumbnail_url && rouletteThumbnails.length < 12) {
      rouletteThumbnails.push(k.thumbnail_url);
    }
  }
  champions.sort((a, b) => a.localeCompare(b));
  return { champions, rouletteThumbnails };
}

export default async function VSPage() {
  const [players, { champions, rouletteThumbnails }] = await Promise.all([
    buildPlayerOptions(),
    buildChampionsAndThumbnails(),
  ]);
  const eraOptions = buildEraOptions(ERAS);

  const breadcrumbJsonLd = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "VS Roulette", url: "/vs" },
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
      <JsonLd data={breadcrumbJsonLd} />

      {/* ─── Hero strip — gold sweep + cinematic title ────────────── */}
      <section
        className="relative overflow-hidden border-b border-[var(--border-gold)]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 30%, rgba(200,170,110,0.18) 0%, transparent 60%), linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-primary) 100%)",
        }}
      >
        {/* Subtle scanline overlay — matches the homepage hero */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
          }}
        />
        {/* Floating gold rhombus accents */}
        <div
          aria-hidden
          className="absolute left-[5%] top-10 hidden md:block"
          style={{
            width: 14,
            height: 14,
            transform: "rotate(45deg)",
            background: "linear-gradient(135deg, var(--gold), var(--gold-dark))",
            opacity: 0.55,
            boxShadow: "0 0 22px rgba(200,170,110,0.5)",
          }}
        />
        <div
          aria-hidden
          className="absolute right-[7%] top-24 hidden md:block"
          style={{
            width: 9,
            height: 9,
            transform: "rotate(45deg)",
            background: "var(--gold)",
            opacity: 0.4,
            boxShadow: "0 0 14px rgba(200,170,110,0.4)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-6xl px-5 pt-12 pb-8 md:pt-20 md:pb-12 text-center">
          <nav
            aria-label="Fil d'Ariane"
            className="mb-6 flex items-center justify-center gap-2 text-xs text-white/55"
          >
            <Link
              href="/"
              className="hover:text-[var(--gold)] transition-colors"
            >
              Accueil
            </Link>
            <span aria-hidden className="text-white/25">
              {"◆"}
            </span>
            <span className="text-[var(--gold)]">VS Roulette</span>
          </nav>

          <p className="font-data text-[11px] uppercase tracking-[0.4em] text-[var(--gold)]/70 mb-3">
            La roulette des kills · Wave 25.3
          </p>
          <h1
            className="font-display font-black tracking-tight leading-[0.85] text-5xl md:text-7xl lg:text-[7.5rem]"
            style={{
              color: "white",
              textShadow:
                "0 0 60px rgba(200,170,110,0.45), 0 6px 30px rgba(0,0,0,0.85)",
              letterSpacing: "-0.015em",
            }}
          >
            VS <span className="text-shimmer">ROULETTE</span>
          </h1>
          <p className="mt-5 mx-auto max-w-2xl text-base md:text-lg text-white/80 font-medium">
            Deux clips. Une roulette. Un seul gagnant. Filtre par joueur,
            champion, époque ou type de kill — laisse la communauté décider
            quel kill Karmine Corp est le plus fort.
          </p>

          <div className="mt-7 flex items-center justify-center gap-3 flex-wrap">
            <Link
              href="/vs/leaderboard"
              className="rounded-xl border border-[var(--gold)]/40 bg-black/35 backdrop-blur-sm px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--gold)] transition-all hover:border-[var(--gold)]/80 hover:bg-[var(--gold)]/10"
            >
              Voir le classement ELO
            </Link>
            <Link
              href="/scroll"
              className="rounded-xl border border-white/20 bg-black/25 backdrop-blur-sm px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-white/75 transition-all hover:border-white/45 hover:text-white"
            >
              Mode scroll
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Client roulette ─────────────────────────────────────── */}
      <Suspense
        fallback={
          <div className="mx-auto max-w-6xl px-4 py-16 text-center font-data text-xs uppercase tracking-[0.3em] text-[var(--text-muted)]">
            Chargement de la roulette…
          </div>
        }
      >
        <VSRoulette
          players={players}
          champions={champions}
          eras={eraOptions}
          rouletteThumbnails={rouletteThumbnails}
        />
      </Suspense>

      {/* ─── Disclaimer Riot — required on every public page ────── */}
      <p
        aria-label="Riot Games disclaimer"
        className="px-4 pb-6 text-center text-[9px] uppercase tracking-widest text-white/30"
      >
        Not endorsed by Riot Games. League of Legends © Riot Games.
      </p>
    </div>
  );
}
