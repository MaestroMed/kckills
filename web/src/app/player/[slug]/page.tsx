import { notFound } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

import { loadRealData, getPlayerStats, getCurrentRoster } from "@/lib/real-data";
import { championSplashUrl, championLoadingUrl, championIconUrl } from "@/lib/constants";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { ClipReel } from "@/components/ClipReel";
import { getPlayerByIgn } from "@/lib/supabase/players";
import { getPublicRiotStatsBySummoner } from "@/lib/supabase/riot_profile";
import { getKillsByKillerChampion } from "@/lib/supabase/kills";
import type { PublishedKillRow } from "@/lib/supabase/kills";
import { JsonLd, breadcrumbLD } from "@/lib/seo/jsonld";
import { WolfHowlOnEnter } from "@/components/player/WolfHowlOnEnter";
import { MatchHistory } from "./match-history";
import {
  PlayerRadar,
  ChampionPerformanceChart,
  RecentFormChart,
} from "@/components/PlayerChartsLazy";
import { getQuotesByPlayer } from "@/lib/quotes";

import { PlayerHero } from "@/components/player/PlayerHero";
import { SignatureQuote } from "@/components/player/SignatureQuote";
import { ChampionPoolHextech } from "@/components/player/ChampionPoolHextech";
import { HonorsAndEras } from "@/components/player/HonorsAndEras";
import { TeammatesGrid } from "@/components/player/TeammatesGrid";
import { PrevNextNavCard } from "@/components/player/PrevNextNavCard";
import { HeadToHead } from "@/components/player/HeadToHead";
import { ERAS, type Era } from "@/lib/eras";

// Wave 13d (2026-04-28) : 300 → 1800. Player stats are essentially
// static between matches (one new game every 1-3 days for KC).
export const revalidate = 1800;

interface Props {
  params: Promise<{ slug: string }>;
}

// ─── Jersey numbers by signing order ──────────────────────────────────────
// Per blueprint :
//   Canna 1, Yike 2, Kyeahoo 3, Caliste 4, Busio 5.
// Falls back to a stable hash-based number for any other player.
const JERSEY_NUMBERS: Record<string, number> = {
  Canna: 1,
  Yike: 2,
  Kyeahoo: 3,
  kyeahoo: 3,
  Caliste: 4,
  Busio: 5,
};

function jerseyFor(name: string): number {
  const direct = JERSEY_NUMBERS[name];
  if (direct) return direct;
  // Stable hash → 1..99 — keeps numbers consistent across re-renders.
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (h % 89) + 10;
}

// ─── Achievement strip per player ─────────────────────────────────────────
// Hand-curated honors tied to each current KC player. Pulled from CLAUDE.md
// roster + research. Keeps the hero strip short — 3 lines max.
const ACHIEVEMENTS: Record<string, string[]> = {
  Canna: ["ARMÉE KC", "MVP LEC WINTER 2025", "EX-T1 · CHAMPION DU MONDE 2020"],
  Yike: ["VOCAL LEADER", "EX-G2", "JUNGLER DU SACRE 2025"],
  Kyeahoo: ["RECRUE 2026", "EX-DRX CHALLENGERS", "MID LANE KR"],
  kyeahoo: ["RECRUE 2026", "EX-DRX CHALLENGERS", "MID LANE KR"],
  Caliste: ["ARMÉE KC", "ROOKIE OF THE YEAR 2025", "ROYAL ROADER · LEC WINTER 2025"],
  Busio: ["WORLDS 2024 · 2025", "EX-FLYQUEST", "RECRUE 2026"],
};

const ROLE_LABEL: Record<string, string> = {
  top: "TOP",
  jungle: "JGL",
  mid: "MID",
  bottom: "ADC",
  adc: "ADC",
  support: "SUP",
};

// ─── Real-kills proxy (legacy champion-based filter, kept as fallback) ───
async function getRealKillsForPlayer(
  playerCleanName: string,
  topChampions: { name: string }[],
  data: ReturnType<typeof loadRealData>,
): Promise<PublishedKillRow[]> {
  if (topChampions.length === 0) return [];
  const championNames = topChampions.slice(0, 5).map((c) => c.name);
  const perChampion = await Promise.all(
    championNames.map((c) => getKillsByKillerChampion(c, 20)),
  );
  const seen = new Set<string>();
  const candidates: PublishedKillRow[] = [];
  for (const batch of perChampion) {
    for (const k of batch) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      candidates.push(k);
    }
  }
  return candidates.filter((k) => {
    const matchExtId = k.games?.matches?.external_id ?? "";
    if (!matchExtId) return false;
    const match = data.matches.find((m) => m.id === matchExtId);
    if (!match) return false;
    const gameNumber = k.games?.game_number ?? 1;
    const game = match.games.find((g) => g.number === gameNumber);
    if (!game) return false;
    return game.kc_players.some(
      (p) =>
        p.champion === k.killer_champion &&
        p.name.replace("KC ", "") === playerCleanName,
    );
  });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const name = decodeURIComponent(slug);
  const data = loadRealData();
  const stats = getPlayerStats(data, name);
  const photo = PLAYER_PHOTOS[name];
  const canonicalPath = `/player/${encodeURIComponent(name)}`;

  const description =
    stats.gamesPlayed > 0
      ? `${name} — Karmine Corp · ${stats.gamesPlayed} games, ${stats.kills} kills, KDA ${stats.kda}. Explore les meilleurs moments et stats du joueur sur KCKILLS.`
      : `${name} — Profil Karmine Corp sur KCKILLS.`;

  return {
    title: name,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: `${name} — KCKILLS`,
      description,
      type: "profile",
      url: canonicalPath,
      images: photo
        ? [{ url: photo, width: 1200, height: 630, alt: name }]
        : undefined,
      siteName: "KCKILLS",
      locale: "fr_FR",
    },
    twitter: {
      card: "summary_large_image",
      title: `${name} — KCKILLS`,
      description,
      images: photo ? [photo] : undefined,
    },
  };
}

export default async function PlayerPage({ params }: Props) {
  const { slug } = await params;
  const name = decodeURIComponent(slug);
  const data = loadRealData();
  const stats = getPlayerStats(data, name);

  if (stats.gamesPlayed === 0) notFound();

  const photo = PLAYER_PHOTOS[name];
  const signatureChamp = stats.champions[0]?.name ?? "Jhin";

  const playerPhoto = PLAYER_PHOTOS[name];
  const morphImages = [
    ...(playerPhoto ? [playerPhoto] : []),
    ...stats.champions.slice(0, 5).map((c) => championSplashUrl(c.name)),
  ];
  if (morphImages.length === 0) morphImages.push(championSplashUrl(signatureChamp));

  const realKills = await getRealKillsForPlayer(name, stats.champions, data);

  const playerRow = await getPlayerByIgn(name);
  const playerId = playerRow?.id ?? null;

  const riotStats = await getPublicRiotStatsBySummoner(name);

  const winRate = stats.matchHistory.length
    ? Math.round(
        (stats.matchHistory.filter((m) => m.won).length / stats.matchHistory.length) * 100,
      )
    : 0;

  const customBg = `/images/players/player-bg-${name.toLowerCase()}.jpg`;

  // ─── Year range from match history (first → last) ───────────────────────
  const yearRange =
    stats.matchHistory.length > 0
      ? {
          first: stats.matchHistory[stats.matchHistory.length - 1]?.date.slice(0, 4) ?? "",
          last: stats.matchHistory[0]?.date.slice(0, 4) ?? "",
        }
      : undefined;

  // ─── Eras this player has played through ───────────────────────────────
  // We don't have a per-player era map yet — derive one by intersecting the
  // dates in match history with the era windows. This catches everything from
  // LEC Winter 2025 to LEC Spring 2026 for the current active roster.
  const playerEras: Era[] = (() => {
    if (stats.matchHistory.length === 0) return [];
    const matchDates = new Set(stats.matchHistory.map((m) => m.date));
    const found = new Set<string>();
    for (const date of matchDates) {
      for (const era of ERAS) {
        if (date >= era.dateStart && date <= era.dateEnd) found.add(era.id);
      }
    }
    return Array.from(found)
      .map((id) => ERAS.find((e) => e.id === id))
      .filter((e): e is Era => e !== undefined);
  })();

  // ─── Teammates (current 2026 KC roster excluding self) ─────────────────
  const roster = getCurrentRoster(data);
  const teammates = roster
    .filter((p) => p.name.toLowerCase() !== name.toLowerCase())
    .slice(0, 4)
    .map((p) => ({
      name: p.name,
      role: p.role,
      roleLabel: ROLE_LABEL[p.role] ?? p.role.toUpperCase(),
      photoUrl: PLAYER_PHOTOS[p.name] ?? undefined,
      signatureChampion: p.champions[0] ?? "Jhin",
    }));

  // ─── Prev / next player navigation (active roster only) ────────────────
  const rosterNames = roster.map((p) => p.name);
  const rosterIdx = rosterNames.findIndex(
    (n) => n.toLowerCase() === name.toLowerCase(),
  );
  const prevPlayer =
    rosterIdx > 0 ? { slug: rosterNames[rosterIdx - 1], name: rosterNames[rosterIdx - 1] } : undefined;
  const nextPlayer =
    rosterIdx >= 0 && rosterIdx < rosterNames.length - 1
      ? { slug: rosterNames[rosterIdx + 1], name: rosterNames[rosterIdx + 1] }
      : undefined;

  // ─── Quote — first quote sourced for this player slug ─────────────────
  const playerQuotes = getQuotesByPlayer(name);
  const heroQuote = playerQuotes[0];

  // ─── JSON-LD ──────────────────────────────────────────────────────────
  const personNode = {
    "@type": "Person",
    "@id": `https://kckills.com/player/${encodeURIComponent(name)}#person`,
    name,
    alternateName: `KC ${name}`,
    url: `https://kckills.com/player/${encodeURIComponent(name)}`,
    image: photo ? `https://kckills.com${photo}` : undefined,
    jobTitle: "Pro Player",
    description: `${name} — joueur Karmine Corp en LEC. ${stats.kills} kills, ${stats.deaths} deaths, ${stats.assists} assists sur ${stats.gamesPlayed} games.`,
    memberOf: {
      "@type": "SportsTeam",
      name: "Karmine Corp",
      alternateName: ["KC", "KCorp"],
      url: "https://kckills.com",
      sport: "League of Legends",
    },
    knowsAbout: stats.champions.slice(0, 5).map((c) => c.name),
    ...(realKills.length > 0
      ? {
          subjectOf: {
            "@type": "ItemList",
            name: `Clips de ${name}`,
            numberOfItems: realKills.length,
            itemListElement: realKills.slice(0, 10).map((k, i) => ({
              "@type": "ListItem",
              position: i + 1,
              url: `https://kckills.com/kill/${k.id}`,
            })),
          },
        }
      : {}),
  };

  const playerJsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url: `https://kckills.com/player/${encodeURIComponent(name)}`,
    name: `${name} — KCKILLS`,
    inLanguage: "fr-FR",
    mainEntity: personNode,
  };

  const breadcrumbJsonLd = breadcrumbLD([
    { name: "Accueil", url: "/" },
    { name: "Joueurs", url: "/players" },
    { name, url: `/player/${encodeURIComponent(name)}` },
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
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(playerJsonLd) }}
      />
      <JsonLd data={breadcrumbJsonLd} />
      <WolfHowlOnEnter />

      {/* ═══ SECTION 1 — HERO ═══════════════════════════════════════════════ */}
      <PlayerHero
        name={name}
        photo={photo ?? null}
        signatureChampion={signatureChamp}
        customBgUrl={customBg}
        morphImages={morphImages}
        jerseyNumber={jerseyFor(name)}
        stats={{
          kda: stats.kda,
          gamesPlayed: stats.gamesPlayed,
          avgKills: stats.avgKills,
          avgDeaths: stats.avgDeaths,
          avgAssists: stats.avgAssists,
          winRate,
        }}
        achievements={ACHIEVEMENTS[name] ?? ["KARMINE CORP"]}
        yearRange={yearRange}
        prevPlayer={prevPlayer}
        nextPlayer={nextPlayer}
      />

      {/* ═══ SECTION 2 — SIGNATURE QUOTE ════════════════════════════════════ */}
      {heroQuote && (
        <section
          className="relative max-w-7xl mx-auto px-6"
          aria-labelledby="player-signature-quote"
        >
          <h2 id="player-signature-quote" className="sr-only">
            Citation signature
          </h2>
          <SignatureQuote
            text={heroQuote.text}
            author={heroQuote.author}
            role={heroQuote.role}
            source={heroQuote.source}
            accent="var(--gold)"
          />
        </section>
      )}

      {/* ═══ SECTION 3 — CHAMPION POOL HEXTECH ═════════════════════════════ */}
      {stats.champions.length > 0 && (
        <section className="relative max-w-7xl mx-auto px-6 py-16">
          <SectionHeader kicker={`Champion pool · ${stats.champions.length} champions`} />
          <ChampionPoolHextech champions={stats.champions} accent="var(--gold)" />
        </section>
      )}

      {/* ═══ SECTION 4 — ANALYTICS ════════════════════════════════════════ */}
      <section className="relative max-w-7xl mx-auto px-6 py-16">
        <SectionHeader kicker="Analytics" />
        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
            <h3 className="font-display text-sm font-bold mb-4 text-[var(--text-secondary)]">
              Profil de jeu
            </h3>
            <div className="flex justify-center">
              <PlayerRadar
                avgKills={parseFloat(stats.avgKills)}
                avgDeaths={parseFloat(stats.avgDeaths)}
                avgAssists={parseFloat(stats.avgAssists)}
                gamesPlayed={stats.gamesPlayed}
                totalGold={stats.totalGold}
                totalCS={stats.totalCS}
              />
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
            <h3 className="font-display text-sm font-bold mb-4 text-[var(--text-secondary)]">
              Champions &middot; games jou&eacute;es
            </h3>
            <ChampionPerformanceChart champions={stats.champions} />
          </div>
          <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
            <h3 className="font-display text-sm font-bold mb-4 text-[var(--text-secondary)]">
              Forme r&eacute;cente &middot; KDA par match
            </h3>
            <RecentFormChart history={stats.matchHistory} />
          </div>
        </div>

        {/* Wave 31d — farming + economy card. Per-game averages because
            per-minute would need game duration which the static log
            doesn't carry. LEC averages ~33min so /min ≈ /game / 33. */}
        {stats.gamesPlayed > 0 && (
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--text-muted)]">
                CS par game
              </p>
              <p className="font-data text-4xl font-black tabular-nums text-[var(--gold)] mt-2">
                {stats.avgCS.toLocaleString("fr-FR")}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                ≈{" "}
                <span className="text-[var(--text-secondary)] font-data">
                  {(stats.avgCS / 33.5).toFixed(1)}
                </span>{" "}
                CS/min (game moyenne LEC 33:30)
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--text-muted)]">
                Gold par game
              </p>
              <p className="font-data text-4xl font-black tabular-nums text-[var(--gold)] mt-2">
                {stats.avgGold.toLocaleString("fr-FR")}
              </p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                ≈{" "}
                <span className="text-[var(--text-secondary)] font-data">
                  {Math.round(stats.avgGold / 33.5).toLocaleString("fr-FR")}
                </span>{" "}
                gold/min
              </p>
            </div>
            <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
              <p className="text-[10px] uppercase tracking-[0.25em] text-[var(--text-muted)]">
                Series winrate
              </p>
              <p
                className="font-data text-4xl font-black tabular-nums mt-2"
                style={{
                  color:
                    winRate >= 65
                      ? "var(--green)"
                      : winRate >= 50
                        ? "var(--gold)"
                        : "var(--red)",
                }}
              >
                {winRate}%
              </p>
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                {stats.wins ?? 0} wins sur{" "}
                {stats.matchHistory.length} séries (game-level)
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ─── Riot stats — surfaced when linked ──────────────────────────── */}
      {riotStats && (riotStats.rank || riotStats.topChampions.length > 0) && (
        <section className="relative max-w-7xl mx-auto px-6 py-10">
          <SectionHeader kicker="Riot stats · profil lié" />
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
                Compte Riot
              </p>
              <p className="font-display text-2xl font-black text-[var(--gold)] leading-tight break-words">
                {riotStats.summonerName}
                {riotStats.tag && (
                  <span className="font-data text-base text-[var(--text-muted)]">
                    #{riotStats.tag}
                  </span>
                )}
              </p>
              {riotStats.linkedAt && (
                <p className="text-[10px] text-[var(--text-muted)] opacity-70">
                  Lié le{" "}
                  {new Date(riotStats.linkedAt).toLocaleDateString("fr-FR", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
            <div className="rounded-2xl border border-[var(--gold)]/30 bg-[var(--gold)]/5 p-5 space-y-2">
              <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
                Rank Solo/Duo
              </p>
              {riotStats.rank ? (
                <p className="font-display text-3xl font-black text-[var(--gold)] leading-tight">
                  {riotStats.rank}
                </p>
              ) : (
                <p className="text-sm text-[var(--text-muted)]">Aucun rank Solo/Duo cette saison.</p>
              )}
            </div>
            <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5 space-y-3">
              <p className="text-[10px] uppercase tracking-[0.3em] text-[var(--text-muted)]">
                Top {riotStats.topChampions.length} champions
              </p>
              {riotStats.topChampions.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">Pas de mastery enregistrée.</p>
              ) : (
                <ul className="grid grid-cols-5 gap-2">
                  {riotStats.topChampions.map((c) => (
                    <li
                      key={c.champ_id}
                      className="flex flex-col items-center gap-1"
                      title={`${c.name} — niveau ${c.level} · ${c.points.toLocaleString("fr-FR")} pts`}
                    >
                      <div className="relative h-10 w-10 rounded-full overflow-hidden border border-[var(--border-gold)] bg-[var(--bg-elevated)]">
                        <Image
                          src={championIconUrl(c.name)}
                          alt={c.name}
                          fill
                          sizes="40px"
                          className="object-cover"
                        />
                      </div>
                      <span className="text-[9px] font-data text-[var(--text-muted)]">M{c.level}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ═══ SECTION 4.5 — HEAD-TO-HEAD ═══════════════════════════════════ */}
      {/* Wave 31a — surface the player's biggest nemesis + favourite
          victim with a deep-link into /face-off. Renders only if at least
          one side has data (HeadToHead returns null otherwise). */}
      <HeadToHead playerSlug={name} playerName={name} />

      {/* ═══ SECTION 5 — CLIP REEL ═════════════════════════════════════════ */}
      {playerId && (
        <section className="relative max-w-7xl mx-auto px-6 py-16 space-y-12">
          <ClipReel
            kicker="Pipeline automatique"
            title={`Les meilleurs kills de ${name}`}
            subtitle="Clips où ce joueur termine l'adversaire — classés par highlight score puis rating communauté."
            filter={{
              killerPlayerId: playerId,
              trackedTeamInvolvement: "team_killer",
              minHighlight: 5,
            }}
            limit={9}
            ctaHref="/scroll"
            ctaLabel="Tout voir dans le scroll"
            emptyState={null}
          />

          <ClipReel
            kicker="Carry mode"
            title="Clutch & multi-kills"
            subtitle="First Bloods, doubles+ et plays au score IA ≥ 7.5 sur ce joueur."
            filter={{
              killerPlayerId: playerId,
              trackedTeamInvolvement: "team_killer",
              minHighlight: 7.5,
            }}
            limit={6}
            emptyState={null}
          />

          <ClipReel
            kicker="L'envers du décor"
            title="Kills subis"
            subtitle="Quand l'adversaire prend l'avantage — utile pour analyser ses death patterns."
            filter={{
              victimPlayerId: playerId,
              trackedTeamInvolvement: "team_victim",
            }}
            limit={6}
            emptyState={null}
          />
        </section>
      )}

      {/* Legacy champion-proxy fallback — kept until killer_player_id reaches 100% coverage. */}
      {!playerId && realKills.length > 0 && (
        <section className="relative max-w-7xl mx-auto px-6 py-16">
          <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-[var(--gold)] animate-pulse" />
              <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
                {realKills.length} clips vidéo
              </span>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              Générés par le pipeline automatique · vrais highlights
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {realKills.slice(0, 6).map((k) => (
              <Link
                key={k.id}
                href={`/kill/${k.id}`}
                className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-black transition-all hover:border-[var(--gold)]/60 hover:scale-[1.02] hover:-translate-y-1"
                style={{ aspectRatio: "16/10" }}
              >
                <Image
                  src={championSplashUrl(k.killer_champion ?? "Aatrox")}
                  alt={`${k.killer_champion} vs ${k.victim_champion}`}
                  fill
                  sizes="(max-width: 768px) 100vw, 33vw"
                  className="object-cover opacity-60 group-hover:opacity-80 transition-opacity"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                <div className="absolute bottom-0 inset-x-0 p-4 z-10">
                  <p className="font-display text-lg font-black text-white">
                    {k.killer_champion} → {k.victim_champion}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ═══ SECTION 6 — MATCH HISTORY ═════════════════════════════════════ */}
      <section className="relative max-w-7xl mx-auto px-6 py-16">
        <SectionHeader kicker="Historique complet" />
        <MatchHistory history={stats.matchHistory} />
      </section>

      {/* ═══ SECTION 7 — HONORS & ÉPOQUES KC ══════════════════════════════ */}
      {playerEras.length > 0 && (
        <section className="relative max-w-5xl mx-auto px-6 py-16">
          <SectionHeader kicker={`Honors · ${playerEras.length} époques`} />
          <HonorsAndEras eras={playerEras} accent="var(--gold)" />
        </section>
      )}

      {/* ═══ SECTION 8 — COÉQUIPIERS ACTUELS + AUXILIAIRES ════════════════ */}
      {teammates.length > 0 && (
        <section className="relative max-w-7xl mx-auto px-6 py-16">
          <SectionHeader kicker="Coéquipiers actuels" />
          <TeammatesGrid teammates={teammates} accent="var(--gold)" />

          {/* Auxiliary links — Leaguepedia + all kills */}
          <div className="mt-10 grid gap-3 md:grid-cols-2">
            <Link
              href={`/scroll?killerPlayerId=${playerId ?? ""}`}
              className="flex items-center justify-between rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] px-5 py-4 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/50 hover:text-[var(--gold)] focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
              aria-label={`Voir tous les kills de ${name} dans le scroll`}
            >
              <span className="flex items-center gap-3">
                <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  scroll
                </span>
                <span>Tous les kills de {name}</span>
              </span>
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
            <a
              href={`https://lol.fandom.com/wiki/${encodeURIComponent(name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] px-5 py-4 text-sm text-[var(--text-secondary)] transition-colors hover:border-[var(--gold)]/50 hover:text-[var(--gold)] focus-visible:outline-2 focus-visible:outline-[var(--gold)] focus-visible:outline-offset-2"
            >
              <span className="flex items-center gap-3">
                <span className="font-data text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
                  wiki
                </span>
                <span>Leaguepedia — {name}</span>
              </span>
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>

          {/* Prev / Next */}
          {(prevPlayer || nextPlayer) && (
            <div className="mt-12 grid gap-4 md:grid-cols-2">
              {prevPlayer && (
                <PrevNextNavCard
                  direction="prev"
                  variant="active"
                  basePath="/player/"
                  entity={{
                    slug: prevPlayer.slug,
                    name: prevPlayer.name,
                    subtitle: "Karmine Corp",
                    accentColor: "#C8AA6E",
                  }}
                />
              )}
              {nextPlayer && (
                <PrevNextNavCard
                  direction="next"
                  variant="active"
                  basePath="/player/"
                  entity={{
                    slug: nextPlayer.slug,
                    name: nextPlayer.name,
                    subtitle: "Karmine Corp",
                    accentColor: "#C8AA6E",
                  }}
                />
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Local section-header helper ───────────────────────────────────────
function SectionHeader({ kicker }: { kicker: string }) {
  return (
    <div className="flex items-center gap-3 mb-8">
      <span className="h-px w-12 bg-[var(--gold)]" />
      <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
        {kicker}
      </span>
      <span className="text-[var(--gold)]/40 text-xs" aria-hidden>
        ◆
      </span>
    </div>
  );
}
