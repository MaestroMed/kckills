/**
 * /face-off — Player vs Player Face-Off (V61).
 *
 * Server shell :
 *   1. Builds the player option list — current 2026 roster + alumni from
 *      lib/alumni.ts. Slug = ign verbatim (matches the players.ign
 *      lookups inside the data helpers).
 *   2. Reads ?a=&b= from searchParams. If both resolve to a known
 *      player AND the DB returns stats, pre-fetches the full bundle
 *      (stats, top 10 kills, most-killed/most-killed-by) and pushes
 *      it into <FaceOff />. Otherwise <FaceOff /> renders the selector
 *      intro screen.
 *   3. Pre-fetches the current vote tally for the (a,b) pair AND the
 *      top duels leaderboard for the footer.
 *
 * Cache strategy : revalidate=900 (15 min). Roster/alumni list is
 * effectively static between matches ; the per-pair tally is fetched on
 * load — but the SSR snapshot is good enough as the initial value (the
 * client component reconciles via fn_record_face_off_vote on first vote).
 *
 * The route is dynamic-segment-friendly : `searchParams` is awaited per
 * the Next 15 API.
 */

import type { Metadata } from "next";
import Link from "next/link";

import {
  getFaceOffTally,
  getMostKilledOpponent,
  getMostVictimizedBy,
  getPlayerFaceOffStats,
  getTopFaceOffDuels,
  getTopKillsByPlayer,
  type FaceOffPlayerStats,
  type FaceOffTopKill,
  type MostKilledOpponent,
} from "@/lib/supabase/face-off";
import { loadRealData, getCurrentRoster, type RosterPlayer } from "@/lib/real-data";
import { ALUMNI, type Alumni } from "@/lib/alumni";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";

import {
  FaceOff,
  type FaceOffBundle,
  type FaceOffPlayerOption,
  type FaceOffPresetDuel,
} from "@/components/FaceOff";

export const revalidate = 900;

// ════════════════════════════════════════════════════════════════════
// Metadata
// ════════════════════════════════════════════════════════════════════

interface PageProps {
  searchParams: Promise<{ a?: string; b?: string }>;
}

export async function generateMetadata({ searchParams }: PageProps): Promise<Metadata> {
  const sp = await searchParams;
  const a = (sp.a ?? "").trim();
  const b = (sp.b ?? "").trim();

  const title =
    a && b
      ? `${capitalize(a)} vs ${capitalize(b)} — Face-Off KC`
      : "Player vs Player Face-Off — KCKILLS";
  const description =
    a && b
      ? `Comparaison complète : stats, top 10 kills, vote communauté. Qui est le meilleur entre ${capitalize(a)} et ${capitalize(b)} chez la Karmine Corp ?`
      : "Le duel ultime. Choisis deux joueurs Karmine Corp (roster ou alumni), compare leurs stats, leurs meilleurs kills, et fais voter la communauté.";
  const path = a && b ? `/face-off?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}` : "/face-off";

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title,
      description,
      type: "website",
      url: path,
      siteName: "KCKILLS",
      locale: "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

function capitalize(s: string): string {
  if (!s) return "";
  return s[0].toUpperCase() + s.slice(1).toLowerCase();
}

// ════════════════════════════════════════════════════════════════════
// Player option list — current 2026 roster + alumni
// ════════════════════════════════════════════════════════════════════

function buildPlayerOptions(): FaceOffPlayerOption[] {
  const data = loadRealData();
  const current = getCurrentRoster(data);

  const out: FaceOffPlayerOption[] = [];
  const seen = new Set<string>();

  // Current roster — slug = ign (lower-cased here for stable matching)
  for (const p of current) {
    const slug = p.name.toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    out.push({
      slug,
      name: p.name,
      era: "Roster 2026",
      role: p.role,
      photoUrl: PLAYER_PHOTOS[p.name] ?? null,
      signatureChampion: p.champions[0] ?? "Jhin",
      isCurrent: true,
    });
  }

  // Alumni — slug = alumni.slug (already canonical lower-case)
  for (const a of ALUMNI) {
    if (seen.has(a.slug)) continue;
    seen.add(a.slug);
    out.push({
      slug: a.slug,
      name: a.name,
      era: `Alumni · ${a.period}`,
      role: roleSlug(a.role),
      photoUrl: PLAYER_PHOTOS[a.name] ?? null,
      signatureChampion: a.signatureChampion,
      isCurrent: false,
    });
  }

  // Sort : current roster first (ordered by role), then alumni by period DESC.
  out.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    if (a.isCurrent && b.isCurrent) {
      return roleOrder(a.role) - roleOrder(b.role);
    }
    return b.era.localeCompare(a.era);
  });
  return out;
}

function roleSlug(role: Alumni["role"] | RosterPlayer["role"]): string {
  // The alumni `role` enum is top/jungle/mid/adc/support whereas the
  // roster uses `bottom`. Normalise to the players-table convention.
  if (role === "adc") return "bottom";
  return role;
}

function roleOrder(role: string | null): number {
  if (!role) return 99;
  return (
    ({ top: 0, jungle: 1, mid: 2, bottom: 3, adc: 3, support: 4 } as Record<string, number>)[
      role.toLowerCase()
    ] ?? 99
  );
}

// ════════════════════════════════════════════════════════════════════
// Preset duels — the four debates the page is built to settle
// ════════════════════════════════════════════════════════════════════

const PRESET_DUELS: FaceOffPresetDuel[] = [
  {
    aSlug: "caliste",
    bSlug: "rekkles",
    label: "Caliste vs Rekkles",
    subtitle: "Le duel des ADC légendaires",
  },
  {
    aSlug: "canna",
    bSlug: "adam",
    label: "Canna vs Adam",
    subtitle: "T1 import vs showman LFL",
  },
  {
    aSlug: "yike",
    bSlug: "cabochard",
    label: "Yike vs Cabochard",
    subtitle: "Sacre 2025 vs vétéran",
  },
  {
    aSlug: "bo",
    bSlug: "closer",
    label: "Bo vs Closer",
    subtitle: "Jungle 2024 — l'ère sombre",
  },
];

// ════════════════════════════════════════════════════════════════════
// Bundle assembler
// ════════════════════════════════════════════════════════════════════

async function buildBundle(
  slug: string,
  option: FaceOffPlayerOption,
): Promise<FaceOffBundle | null> {
  // Fetch stats, top kills, and the two opponent rollups in parallel.
  // getPlayerFaceOffStats is React-cached so the death-count + kill-aggregate
  // pair only ships once per (slug, render).
  const [stats, topKills, mostKilled, mostVictimizedBy]: [
    FaceOffPlayerStats,
    FaceOffTopKill[],
    MostKilledOpponent | null,
    MostKilledOpponent | null,
  ] = await Promise.all([
    getPlayerFaceOffStats(slug),
    getTopKillsByPlayer(slug, 10),
    getMostKilledOpponent(slug),
    getMostVictimizedBy(slug),
  ]);

  // If the player has no kills at all in the DB and no clips, we still
  // render — the bars + grid will show "no data" states gracefully.
  // Returning null here would force the selector screen, which is a
  // worse UX for alumni who simply don't have a clip backlog yet.
  return {
    player: option,
    stats,
    topKills,
    mostKilled,
    mostVictimizedBy,
  };
}

// ════════════════════════════════════════════════════════════════════
// Page
// ════════════════════════════════════════════════════════════════════

export default async function FaceOffPage({ searchParams }: PageProps) {
  const sp = await searchParams;
  const aRaw = (sp.a ?? "").trim().toLowerCase();
  const bRaw = (sp.b ?? "").trim().toLowerCase();

  const players = buildPlayerOptions();
  const playersBySlug: Record<string, FaceOffPlayerOption> = {};
  for (const p of players) playersBySlug[p.slug] = p;

  // Resolve slugs to player options.
  const optionA = aRaw ? playersBySlug[aRaw] ?? null : null;
  const optionB = bRaw ? playersBySlug[bRaw] ?? null : null;
  const hasBoth = optionA !== null && optionB !== null && aRaw !== bRaw;

  // Run the expensive fetches only when both sides resolved.
  const [bundleA, bundleB, initialTally, topDuels] = await Promise.all([
    hasBoth && optionA ? buildBundle(aRaw, optionA) : Promise.resolve(null),
    hasBoth && optionB ? buildBundle(bRaw, optionB) : Promise.resolve(null),
    hasBoth ? getFaceOffTally(aRaw, bRaw) : Promise.resolve({ votes_a: 0, votes_b: 0, votes_draw: 0 }),
    getTopFaceOffDuels(8),
  ]);

  const breadcrumb = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "Face-Off", url: "/face-off" },
    ...(hasBoth && optionA && optionB
      ? [
          {
            name: `${optionA.name} vs ${optionB.name}`,
            url: `/face-off?a=${encodeURIComponent(aRaw)}&b=${encodeURIComponent(bRaw)}`,
          },
        ]
      : []),
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

      {/* ─── Hero strip — gold sweep, cinematic title ───────────── */}
      <section
        className="relative overflow-hidden border-b border-[var(--border-gold)]"
        style={{
          background:
            "radial-gradient(ellipse 70% 55% at 50% 30%, rgba(200,170,110,0.18) 0%, transparent 60%), linear-gradient(180deg, var(--bg-surface) 0%, var(--bg-primary) 100%)",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.14] mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.08) 3px, transparent 4px)",
          }}
        />
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
            background: "var(--cyan)",
            opacity: 0.45,
            boxShadow: "0 0 14px rgba(10,200,185,0.5)",
          }}
        />

        <div className="relative z-10 mx-auto max-w-6xl px-5 pt-10 pb-6 md:pt-16 md:pb-10 text-center">
          <nav
            aria-label="Fil d'Ariane"
            className="mb-5 flex items-center justify-center gap-2 text-xs text-white/55"
          >
            <Link href="/" className="hover:text-[var(--gold)] transition-colors">
              Accueil
            </Link>
            <span aria-hidden className="text-white/25">
              ◆
            </span>
            <span className="text-[var(--gold)]">Face-Off</span>
          </nav>

          <p className="font-data text-[11px] uppercase tracking-[0.4em] text-[var(--gold)]/70 mb-3">
            Player vs Player · Wave 30d
          </p>
          <h1
            className="font-display font-black tracking-tight leading-[0.85] text-4xl md:text-6xl lg:text-7xl"
            style={{
              color: "white",
              textShadow:
                "0 0 60px rgba(200,170,110,0.45), 0 6px 30px rgba(0,0,0,0.85)",
              letterSpacing: "-0.015em",
            }}
          >
            FACE <span className="text-shimmer">OFF</span>
          </h1>
          <p className="mt-4 mx-auto max-w-2xl text-sm md:text-base text-white/75 font-medium">
            Deux joueurs. Tous les chiffres. Top 10 des kills côte à côte.
            Et c&apos;est la communauté qui tranche.
          </p>
        </div>
      </section>

      <FaceOff
        players={players}
        presets={PRESET_DUELS}
        bundleA={bundleA}
        bundleB={bundleB}
        initialTally={initialTally}
        topDuels={topDuels}
        playersBySlug={playersBySlug}
      />

      {/* ─── Riot disclaimer — required on every public page ───── */}
      <p
        aria-label="Riot Games disclaimer"
        className="px-4 pb-6 text-center text-[9px] uppercase tracking-widest text-white/30"
      >
        Not endorsed by Riot Games. League of Legends © Riot Games.
      </p>
    </div>
  );
}
