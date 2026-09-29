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
 * 29/09/2026 — l'entrée est désormais l'arène (components/vs/VSArena) :
 * écran de sélection façon jeu de combat, manches, vote. La roulette à
 * filtres reste en dessous (FreeRoulette), chargée à la demande.
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

import { ERAS } from "@/lib/eras";
import { getTrackedRoster } from "@/lib/supabase/players";
import { getPublishedKills } from "@/lib/supabase/kills";
import { createCachedAnonSupabase, rethrowIfDynamic } from "@/lib/supabase/server";
import {
  buildEraOptions,
  type VSEraOption,
  type VSPlayerOption,
} from "@/lib/vs-roulette";

import { VSArena } from "@/components/vs/VSArena";
import { FreeRoulette } from "@/components/vs/FreeRoulette";
import { getVSFighters } from "@/lib/supabase/vs-fighters";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";
import { getStaticT } from "@/lib/i18n/server-lang";

export const revalidate = 1800;

export const metadata: Metadata = {
  title: "VS Roulette",
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
  //
  // Wave 36 — case-insensitive dedupe : the players table carries
  // historical duplicates ("kyeahoo"/"Kyeahoo", "Saken"/"SAKEN") that
  // doubled entries in the dropdown. The SQL side matches LOWER(ign)
  // anyway, so one entry per lowercased ign is lossless ; keep the row
  // with a role, then the prettier casing (not ALL-CAPS).
  const score = (ign: string, role: unknown) =>
    (role ? 2 : 0) + (ign !== ign.toUpperCase() ? 1 : 0);
  const byIgn = new Map<string, (typeof roster)[number]>();
  for (const r of roster) {
    if (!r.ign || r.ign === "?") continue;
    const key = r.ign.toLowerCase();
    const prev = byIgn.get(key);
    if (!prev || score(r.ign, r.role) > score(prev.ign, prev.role)) {
      byIgn.set(key, r);
    }
  }
  return [...byIgn.values()]
    .map((r) => ({ ign: r.ign, role: r.role, slug: r.ign }))
    .sort((a, b) => a.ign.localeCompare(b.ign));
}

/**
 * Wave 36 — honest era list. fn_pick_vs_pair filters eras through
 * matches.scheduled_at ; an era whose date range holds fewer than TWO
 * eligible clips can never produce a pair, so offering it in the
 * dropdown guarantees a dead spin ("Aucune paire ne correspond…").
 * Count per era server-side (ISR 30 min) and drop the impossible ones.
 *
 * Known debt (WARN) : gol.gg-imported matches have scheduled_at NULL, so
 * their clips are invisible to era filters — both here and in the RPC.
 * The eras filtered out today (2021-2023 legacy) come back automatically
 * once the worker backfills those dates.
 */
async function buildAvailableEras(): Promise<VSEraOption[]> {
  const all = buildEraOptions(ERAS);
  try {
    const sb = createCachedAnonSupabase(1800);
    const counts = await Promise.all(
      all.map(async (era) => {
        try {
          const { count, error } = await sb
            .from("kills")
            .select("id,games!inner(matches!inner(scheduled_at))", {
              count: "exact",
              head: true,
            })
            .or(
              "publication_status.eq.published,and(publication_status.is.null,status.eq.published)",
            )
            .not("clip_url_vertical", "is", null)
            .gte("games.matches.scheduled_at", era.dateStart)
            .lte("games.matches.scheduled_at", era.dateEnd);
          if (error) return Number.POSITIVE_INFINITY; // fail-open : keep era
          return count ?? 0;
        } catch (err) {
          rethrowIfDynamic(err);
          return Number.POSITIVE_INFINITY;
        }
      }),
    );
    return all.filter((_, i) => counts[i] >= 2);
  } catch (err) {
    rethrowIfDynamic(err);
    return all; // fail-open : the dropdown shows everything
  }
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
  const { t } = getStaticT();
  const [players, { champions, rouletteThumbnails }, eraOptions, fighters] =
    await Promise.all([
      buildPlayerOptions(),
      buildChampionsAndThumbnails(),
      buildAvailableEras(),
      getVSFighters(),
    ]);

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

      {/* ─── L'arène : sélection des combattants, manches, vote ────── */}
      <VSArena fighters={fighters} />

      <nav aria-label="Autres modes VS" className="flex flex-wrap items-center justify-center gap-3 px-4 pb-8">
        <Link
          href="/vs/leaderboard"
          className="rounded-xl border border-[var(--gold)]/40 bg-black/35 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--gold)] transition-all hover:border-[var(--gold)]/80 hover:bg-[var(--gold)]/10"
        >
          {t("p_vsgame.vs_see_elo_ranking")}
        </Link>
        {/* Wave 36 — le Mode Stream (plein écran OBS, arbitrage clavier,
            auto-relance) taillé pour les soirées EtoStark. */}
        <Link
          href="/vs/stream"
          className="rounded-xl border border-[var(--cyan)]/40 bg-black/25 px-5 py-2.5 font-display text-xs font-bold uppercase tracking-[0.25em] text-[var(--cyan)] transition-all hover:border-[var(--cyan)]/80 hover:bg-[var(--cyan)]/10"
        >
          {t("nav.vs_stream")} 📺
        </Link>
      </nav>

      {/* ─── La roulette libre (filtres), chargée à la demande ─────── */}
      <FreeRoulette players={players} champions={champions} eras={eraOptions} rouletteThumbnails={rouletteThumbnails} />
      {/* ─── Disclaimer Riot — required on every public page ────── */}
      <p
        aria-label="Riot Games disclaimer"
        className="px-4 pb-6 text-center text-[9px] uppercase tracking-widest text-[var(--text-muted)]"
      >
        Not endorsed by Riot Games. League of Legends © Riot Games.
      </p>
    </div>
  );
}
