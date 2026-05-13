import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";

import { KC_LOGO, TEAM_LOGOS } from "@/lib/kc-assets";
import { pickAssetUrl } from "@/lib/kill-assets";
import {
  getMatchBySlug,
  getMatchKills,
  getMatchMVP,
  getRelatedMatches,
  type MatchPayload,
} from "@/lib/supabase/match";
import { ERAS, type Era } from "@/lib/eras";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";

import { ReplayHero } from "@/components/match/ReplayHero";
import { MatchSummaryCard } from "@/components/match/MatchSummaryCard";
import { GameSection } from "@/components/match/GameSection";
import { FullKillsGrid } from "@/components/match/FullKillsGrid";
import { RelatedStrip } from "@/components/match/RelatedStrip";
import { MatchTimeline } from "./MatchTimeline";

/**
 * /match/[slug] — premium Match Replay Viewer (Wave 30d).
 *
 * Server-component shell that orchestrates :
 *   1. ReplayHero        — cinematic 21:9 backdrop, score counts-up.
 *   2. MatchSummaryCard  — 3-col format / kills / MVP card.
 *   3. MatchTimeline     — interactive per-game kill axis + side panel.
 *   4. GameSection × n   — picks bar + KDA chart + top-5 mini feed.
 *   5. FullKillsGrid     — every clip of the match in a 4-col grid.
 *   6. RelatedStrip      — prev/next/top-kill/era cards.
 *
 * Data layer : `@/lib/supabase/match` — every read is anon + cached
 * via React's `cache()` so generateMetadata + the page share fetches.
 *
 * Same `revalidate = 600` ISR setting as the legacy page for cache
 * compatibility.
 */

export const revalidate = 600;

interface Props {
  params: Promise<{ slug: string }>;
}

// ─── Skip-to-content link ─────────────────────────────────────────────

function SkipToContent() {
  return (
    <a
      href="#match-main"
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:border focus:border-[var(--gold)] focus:bg-[var(--bg-elevated)] focus:px-3 focus:py-2 focus:text-xs focus:font-bold focus:uppercase focus:tracking-widest focus:text-[var(--gold)]"
    >
      Aller au contenu du match
    </a>
  );
}

// ─── Era resolution ───────────────────────────────────────────────────

function eraForDate(iso: string | null): Era | null {
  if (!iso) return null;
  const d = iso.slice(0, 10);
  for (const era of ERAS) {
    if (d >= era.dateStart && d <= era.dateEnd) return era;
  }
  return null;
}

// ─── Metadata ─────────────────────────────────────────────────────────

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const match = await getMatchBySlug(slug);
  if (!match) return { title: "Match introuvable — KCKILLS" };

  const oppCode = match.opponentTeam?.code ?? "OPP";
  const oppName = match.opponentTeam?.name ?? "Adversaire";
  const stageLabel = match.stage ?? "LEC";
  const title = `KC vs ${oppCode} — ${stageLabel}`;
  const description = `Karmine Corp ${match.kcScore}-${match.oppScore} ${oppName} · Bo${match.bestOf}. Timeline interactive des kills, MVP, top highlights et stats par game sur KCKILLS.`;
  const canonicalPath = `/match/${match.externalId}`;

  return {
    title,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: `${title} — KCKILLS`,
      description,
      type: "website",
      url: canonicalPath,
      siteName: "KCKILLS",
      locale: "fr_FR",
      images: [
        {
          url: "/images/hero-bg.jpg",
          width: 1920,
          height: 1280,
          alt: `KC vs ${oppName} — ${stageLabel}`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} — KCKILLS`,
      description,
      images: ["/images/hero-bg.jpg"],
      creator: "@KarmineCorp",
    },
  };
}

// ─── Page ─────────────────────────────────────────────────────────────

export default async function MatchReplayPage({ params }: Props) {
  const { slug } = await params;

  // Single Supabase round-trip for the match payload + kills (both
  // memoized by React `cache()` so generateMetadata + this render share
  // the in-flight promise).
  const match = await getMatchBySlug(slug);
  if (!match) notFound();

  const [kills, mvp, related] = await Promise.all([
    getMatchKills(match.externalId),
    getMatchMVP(match.externalId, match),
    getRelatedMatches(match),
  ]);

  // Aggregate kill counts across games + first blood timing.
  const totalKills = kills.length;
  const kcKills = kills.filter(
    (k) => k.tracked_team_involvement === "team_killer",
  ).length;
  const oppKills = kills.filter(
    (k) => k.tracked_team_involvement === "team_victim",
  ).length;
  const firstBloodRow = kills.find((k) => k.is_first_blood);
  const firstBloodSeconds = firstBloodRow?.game_time_seconds ?? null;
  const firstBloodByKc =
    firstBloodRow?.tracked_team_involvement === "team_killer";

  // Hero backdrop — highest-scored kill thumbnail.
  const heroKill = kills
    .filter((k) => pickAssetUrl(k, "thumbnail") != null)
    .sort((a, b) => (b.highlight_score ?? 0) - (a.highlight_score ?? 0))[0];
  const backdropUrl = heroKill ? pickAssetUrl(heroKill, "thumbnail") : null;

  // Game pills payload for the hero.
  const heroPills = match.games.map((g) => {
    const known = g.winnerTeamId != null;
    const kcWon = match.kcTeam && g.winnerTeamId === match.kcTeam.id;
    return {
      number: g.number,
      kcWon: known ? kcWon ?? false : null,
      winnerKnown: known,
    };
  });

  // Patch — picks the first non-null patch across games (BOs usually
  // play on the same patch).
  const patch = match.games.find((g) => g.patch)?.patch ?? null;

  // Per-game kill grouping.
  const killsByGame = new Map<number, typeof kills>();
  for (const k of kills) {
    const n = k.games?.game_number ?? 1;
    const bucket = killsByGame.get(n) ?? [];
    bucket.push(k);
    killsByGame.set(n, bucket);
  }
  // Per-game kill counts (live from kills feed — falls back to 0 when
  // the worker hasn't extracted any kills yet for that game).
  function gameKillCounts(gameNumber: number): {
    kcKills: number;
    oppKills: number;
  } {
    const arr = killsByGame.get(gameNumber) ?? [];
    return {
      kcKills: arr.filter((k) => k.tracked_team_involvement === "team_killer")
        .length,
      oppKills: arr.filter((k) => k.tracked_team_involvement === "team_victim")
        .length,
    };
  }

  // Top kill for the related strip.
  const topKill = related.topKillId
    ? kills.find((k) => k.id === related.topKillId) ?? null
    : null;

  // Era of this match.
  const era = eraForDate(match.scheduledAt);

  // Opponent display helpers.
  const oppCode = match.opponentTeam?.code ?? "OPP";
  const oppName = match.opponentTeam?.name ?? "Adversaire";

  // Breadcrumb JSON-LD.
  const breadcrumbJsonLd = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "Matchs", url: "/matches" },
    { name: `KC vs ${oppCode}`, url: `/match/${match.externalId}` },
  ]);

  // SportsEvent JSON-LD.
  const sportsEventJsonLd = buildSportsEventLd({
    match,
    oppCode,
    oppName,
    backdropUrl,
  });

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
      <SkipToContent />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(sportsEventJsonLd) }}
      />
      <JsonLd data={breadcrumbJsonLd} />

      {/* Breadcrumb (visual) */}
      <nav
        aria-label="Fil d'Ariane"
        className="mx-auto max-w-7xl px-4 pt-4 pb-2 text-sm text-[var(--text-muted)] sm:px-6"
      >
        <ol className="flex items-center gap-2">
          <li>
            <Link href="/" className="hover:text-[var(--gold)]">
              Accueil
            </Link>
          </li>
          <li className="text-[var(--gold)]/30" aria-hidden>
            ◆
          </li>
          <li>
            <Link href="/matches" className="hover:text-[var(--gold)]">
              Matchs
            </Link>
          </li>
          <li className="text-[var(--gold)]/30" aria-hidden>
            ◆
          </li>
          <li className="text-[var(--text-secondary)]">
            KC vs {oppCode}
          </li>
        </ol>
      </nav>

      {/* ═══ 1. Hero ═══════════════════════════════════════════════════ */}
      <ReplayHero
        kcLogoSrc={match.kcTeam?.logoUrl ?? KC_LOGO}
        kcName={match.kcTeam?.name ?? "Karmine Corp"}
        opponentName={oppName}
        opponentCode={oppCode}
        opponentLogoSrc={match.opponentTeam?.logoUrl ?? TEAM_LOGOS[oppCode] ?? null}
        kcScore={match.kcScore}
        opponentScore={match.oppScore}
        kcWon={match.kcWon}
        league={match.tournament?.name ?? "LEC"}
        stage={match.stage ?? "LEC"}
        bestOf={match.bestOf}
        date={match.scheduledAt ?? new Date().toISOString()}
        backdropUrl={backdropUrl}
        publishedClipCount={totalKills}
        games={heroPills}
        killsAnchor="kills-feed"
        gameAnchorPrefix="game"
      />

      <main
        id="match-main"
        className="mx-auto max-w-7xl space-y-10 px-4 py-8 sm:px-6 md:py-12"
      >
        {/* ═══ 2. Summary card ════════════════════════════════════════ */}
        <MatchSummaryCard
          bestOf={match.bestOf}
          format={match.format}
          stage={match.stage}
          totalDurationSeconds={match.totalDurationSeconds}
          totalKills={totalKills}
          kcKills={kcKills}
          oppKills={oppKills}
          firstBloodSeconds={firstBloodSeconds}
          firstBloodByKc={firstBloodByKc}
          patch={patch}
          mvp={mvp}
        />

        {/* ═══ 3. Interactive timeline ════════════════════════════════ */}
        {kills.length > 0 && (
          <section aria-labelledby="match-timeline-heading" className="space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <h2
                id="match-timeline-heading"
                className="font-display text-xl font-black uppercase tracking-widest text-[var(--gold)]"
              >
                Timeline interactive
              </h2>
              <p className="hidden sm:block text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                Tap ou survol → preview · clic → clip plein écran
              </p>
            </div>
            <MatchTimeline
              games={match.games.map((g) => {
                const counts = gameKillCounts(g.number);
                return {
                  id: g.id,
                  number: g.number,
                  durationSeconds: g.durationSeconds,
                  kcKills: counts.kcKills,
                  oppKills: counts.oppKills,
                };
              })}
              kills={kills}
              opponentCode={oppCode}
              opponentName={oppName}
              anchorPrefix="game"
            />
          </section>
        )}

        {/* ═══ 4. Per-game sections ═══════════════════════════════════ */}
        {match.games.length > 0 && (
          <section aria-label="Détails par game" className="space-y-6">
            {match.games.map((game) => {
              const counts = gameKillCounts(game.number);
              void counts; // counts already part of header in section
              const gameKills = killsByGame.get(game.number) ?? [];
              const kcWonGame = match.kcTeam
                ? game.winnerTeamId === match.kcTeam.id
                  ? true
                  : game.winnerTeamId
                    ? false
                    : null
                : null;
              return (
                <GameSection
                  key={game.id}
                  game={game}
                  kills={gameKills}
                  kcWon={kcWonGame}
                  opponentCode={oppCode}
                  kcTeamId={match.kcTeam?.id ?? null}
                  anchorId={`game-${game.number}`}
                />
              );
            })}
          </section>
        )}

        {/* ═══ 5. Full kills feed ═════════════════════════════════════ */}
        <FullKillsGrid
          kills={kills}
          opponentCode={oppCode}
          anchorId="kills-feed"
        />

        {/* ═══ 6. Related ═════════════════════════════════════════════ */}
        <RelatedStrip
          previousVsOpponent={related.previousVsOpponent}
          next={related.next}
          topKill={topKill}
          era={era}
          opponentCode={oppCode}
        />

        {/* Riot legal disclaimer — required on every public page. */}
        <p className="border-t border-[var(--border-gold)]/30 pt-6 text-center text-[10px] leading-relaxed text-[var(--text-disabled)]">
          KCKILLS was created under Riot Games&apos; &quot;Legal Jibber
          Jabber&quot; policy using assets owned by Riot Games. Riot Games does
          not endorse or sponsor this project.
        </p>
      </main>
    </div>
  );
}

// ─── JSON-LD builders ─────────────────────────────────────────────────

function buildSportsEventLd({
  match,
  oppCode,
  oppName,
  backdropUrl,
}: {
  match: MatchPayload;
  oppCode: string;
  oppName: string;
  backdropUrl: string | null;
}): Record<string, unknown> {
  const url = `https://kckills.com/match/${match.externalId}`;
  return {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `Karmine Corp vs ${oppName} — ${match.stage ?? "LEC"}`,
    description: `Match LEC : Karmine Corp vs ${oppName} (${match.stage ?? "LEC"}, Bo${match.bestOf}). Résultat : ${match.kcScore}-${match.oppScore} ${match.kcWon ? "victoire KC" : `victoire ${oppCode}`}.`,
    ...(backdropUrl ? { image: backdropUrl } : {}),
    startDate: match.scheduledAt ?? undefined,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: {
      "@type": "VirtualLocation",
      url: "https://lolesports.com/en-US/leagues/lec",
    },
    sport: "League of Legends",
    superEvent: {
      "@type": "SportsEvent",
      name: match.tournament?.name ?? "LEC",
    },
    homeTeam: {
      "@type": "SportsTeam",
      name: "Karmine Corp",
      url: "https://kckills.com",
    },
    awayTeam: {
      "@type": "SportsTeam",
      name: oppName,
      identifier: oppCode,
    },
    competitor: [
      { "@type": "SportsTeam", name: "Karmine Corp" },
      { "@type": "SportsTeam", name: oppName },
    ],
    organizer: {
      "@type": "Organization",
      name: "Riot Games — LEC",
      url: "https://lolesports.com",
    },
    url,
  };
}
