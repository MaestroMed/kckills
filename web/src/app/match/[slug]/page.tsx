import { notFound } from "next/navigation";
import { loadRealData, getMatchById, displayRole } from "@/lib/real-data";
import { championIconUrl } from "@/lib/constants";
import { KC_LOGO, TEAM_LOGOS } from "@/lib/kc-assets";
import { getKillsByMatchExternalId, type PublishedKillRow } from "@/lib/supabase/kills";
import { ClipReel } from "@/components/ClipReel";
import { MatchHero } from "@/components/match/MatchHero";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

export const revalidate = 600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const data = loadRealData();
  const match = getMatchById(data, slug);
  if (!match) return { title: "Match introuvable \u2014 KCKILLS" };
  return {
    title: `KC vs ${match.opponent.code} \u2014 ${match.stage} \u2014 KCKILLS`,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────

function formatGameTime(seconds: number | null): string {
  if (seconds == null) return "??:??";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

function groupKillsByGame(kills: PublishedKillRow[]): Map<number, PublishedKillRow[]> {
  const map = new Map<number, PublishedKillRow[]>();
  for (const k of kills) {
    const n = k.games?.game_number ?? 1;
    const bucket = map.get(n) ?? [];
    bucket.push(k);
    map.set(n, bucket);
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => (a.game_time_seconds ?? 0) - (b.game_time_seconds ?? 0));
  }
  return map;
}

export default async function MatchPage({ params }: Props) {
  const { slug } = await params;

  const [data, realKills] = await Promise.all([
    Promise.resolve(loadRealData()),
    getKillsByMatchExternalId(slug),
  ]);
  const match = getMatchById(data, slug);
  if (!match) notFound();

  const killsByGame = groupKillsByGame(realKills);
  const totalRealKills = realKills.length;

  const date = new Date(match.date);
  const totalKcKills = match.games.reduce((a, g) => a + g.kc_kills, 0);
  const totalOppKills = match.games.reduce((a, g) => a + g.opp_kills, 0);

  // ─── JSON-LD: SportsEvent is the rich-result schema esports leagues
  //     get bucketed under. Two homeTeam/awayTeam facets, score line,
  //     event location (LEC studio for the canonical case), competitor
  //     count = 2. Google has special handling for SportsEvent in the
  //     match-up rich card carousel.
  const matchJsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    name: `Karmine Corp vs ${match.opponent.name} — ${match.stage}`,
    description: `Match LEC : Karmine Corp vs ${match.opponent.name} (${match.stage}, Bo${match.best_of}). Résultat : ${match.kc_score}-${match.opp_score} ${match.kc_won ? "victoire KC" : `victoire ${match.opponent.code}`}.`,
    startDate: match.date,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OnlineEventAttendanceMode",
    location: {
      "@type": "VirtualLocation",
      url: "https://lolesports.com/en-US/leagues/lec",
    },
    sport: "League of Legends",
    superEvent: {
      "@type": "SportsEvent",
      name: match.league,
    },
    homeTeam: {
      "@type": "SportsTeam",
      name: "Karmine Corp",
      url: "https://kckills.com",
    },
    awayTeam: {
      "@type": "SportsTeam",
      name: match.opponent.name,
      identifier: match.opponent.code,
    },
    competitor: [
      { "@type": "SportsTeam", name: "Karmine Corp" },
      { "@type": "SportsTeam", name: match.opponent.name },
    ],
    organizer: {
      "@type": "Organization",
      name: "Riot Games — LEC",
      url: "https://lolesports.com",
    },
    url: `https://kckills.com/match/${match.id}`,
  };

  return (
    <div className="space-y-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(matchJsonLd) }}
      />
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <Link href="/" className="hover:text-[var(--gold)]">Accueil</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <Link href="/matches" className="hover:text-[var(--gold)]">Matchs</Link>
        <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
        <span>KC vs {match.opponent.code}</span>
      </nav>

      {/* Cinematic match hero — replaces the old 56px-logo header.
          Animates the score on mount, gradient flexes win/loss/upcoming. */}
      <MatchHero
        kcLogoSrc={KC_LOGO}
        opponentName={match.opponent.name}
        opponentCode={match.opponent.code}
        opponentLogoSrc={TEAM_LOGOS[match.opponent.code] ?? null}
        kcScore={match.kc_score}
        opponentScore={match.opp_score}
        kcWon={match.kc_won}
        league={match.league}
        stage={match.stage}
        bestOf={match.best_of}
        date={match.date}
        publishedClipCount={totalRealKills}
      />

      {/* Stats globales */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
          <p className="text-2xl font-bold text-[var(--green)]">{totalKcKills}</p>
          <p className="text-xs text-[var(--text-muted)]">KC kills</p>
        </div>
        <div className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
          <p className="text-2xl font-bold text-[var(--red)]">{totalOppKills}</p>
          <p className="text-xs text-[var(--text-muted)]">{match.opponent.code} kills</p>
        </div>
        <div className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
          <p className="text-2xl font-bold">{match.games.length}</p>
          <p className="text-xs text-[var(--text-muted)]">games</p>
        </div>
        <div className="stat-card rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-4 text-center">
          <p className="text-2xl font-bold text-[var(--gold)]">
            {totalOppKills > 0 ? (totalKcKills / totalOppKills).toFixed(1) : "\u221e"}
          </p>
          <p className="text-xs text-[var(--text-muted)]">K/D ratio</p>
        </div>
      </div>

      {/* ═══ Clip-Centric Reels — powered by fn_get_clips_filtered ═══ */}
      {totalRealKills > 0 && (
        <section className="space-y-10 pt-2">
          <ClipReel
            kicker={`KC vs ${match.opponent.code}`}
            title="Les meilleurs kills de ce match"
            subtitle={`Top des highlights tri\u00e9s par score IA. ${totalRealKills} clips vid\u00e9o disponibles pour cette rencontre.`}
            filter={{ matchExternalId: slug, trackedTeamInvolvement: "team_killer" }}
            limit={9}
            ctaHref="/best"
            ctaLabel="Voir tous les meilleurs"
            emptyState={null}
          />
          <ClipReel
            kicker="Multi-kills + clutch"
            title="Action highlights"
            subtitle="Les triples, quadras, pentas et plays au score IA \u2265 7.5 sur cette rencontre."
            filter={{
              matchExternalId: slug,
              trackedTeamInvolvement: "team_killer",
              minHighlight: 7.5,
            }}
            limit={6}
            emptyState={null}
          />
        </section>
      )}

      {/* Real clips banner — only shown when worker has produced clips for this match */}
      {totalRealKills > 0 && (
        <div className="rounded-xl border border-[var(--gold)]/30 bg-gradient-to-r from-[var(--gold)]/10 via-[var(--gold)]/5 to-transparent p-4">
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-[var(--gold)] animate-pulse" />
            <div className="flex-1">
              <p className="font-display text-sm font-bold text-[var(--gold)] uppercase tracking-widest">
                {totalRealKills} clips vidéo disponibles
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                Cliquer sur une pastille de la timeline pour voir le clip, ou {" "}
                <Link href="/scroll" className="underline hover:text-[var(--gold)]">
                  ouvrir /scroll
                </Link>
                {" "}pour le mode TikTok.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Games */}
      {match.games.map((game) => {
        const gameRealKills = killsByGame.get(game.number) ?? [];
        const hasRealTimeline = gameRealKills.length > 0;
        // Normalize position: find latest game_time_seconds so dots are spaced relatively
        const maxGameTime = hasRealTimeline
          ? Math.max(
              ...gameRealKills.map((k) => k.game_time_seconds ?? 0),
              60 * 20, // minimum 20 min so early-only data doesn't cluster everything left
            )
          : 0;

        return (
          <div key={game.id} className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-hidden">
            <div className="flex items-center justify-between border-b border-[var(--border-gold)] px-4 py-3 bg-[var(--bg-primary)]">
              <h2 className="font-semibold">Game {game.number}</h2>
              <div className="flex items-center gap-4">
                <span className="text-sm font-mono">
                  <span className="text-[var(--green)] font-bold">{game.kc_kills}</span>
                  <span className="text-[var(--text-muted)]"> - </span>
                  <span className="text-[var(--red)] font-bold">{game.opp_kills}</span>
                </span>
                <div className="flex gap-2 text-[10px] text-[var(--text-muted)]">
                  <span>{(game.kc_gold / 1000).toFixed(1)}k</span>
                  <span>{game.kc_towers}T</span>
                  <span>{game.kc_dragons}D</span>
                  <span>{game.kc_barons}B</span>
                </div>
              </div>
            </div>

            {/* Kill timeline */}
            <div className="bg-[var(--bg-primary)] p-4 border-b border-[var(--border-gold)]">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] uppercase tracking-wider text-[var(--text-disabled)]">Kill Timeline</p>
                {hasRealTimeline && (
                  <p className="text-[9px] uppercase tracking-wider text-[var(--gold)]">
                    {gameRealKills.length} clips
                  </p>
                )}
              </div>

              {hasRealTimeline ? (
                <RealKillTimeline
                  kills={gameRealKills}
                  maxGameTime={maxGameTime}
                  opponentCode={match.opponent.code}
                />
              ) : (
                <AggregateDots
                  kcKills={game.kc_kills}
                  oppKills={game.opp_kills}
                  opponentCode={match.opponent.code}
                />
              )}

              <div className="flex justify-between mt-1.5 text-[9px] text-[var(--text-disabled)]">
                <span>KC {game.kc_kills} kills</span>
                <span>{match.opponent.code} {game.opp_kills} kills</span>
              </div>
            </div>

            {/* VOD link if available */}
            {game.vods && game.vods.length > 0 && (
              <div className="px-4 py-2 border-b border-[var(--border-gold)]">
                <div className="flex flex-wrap gap-2">
                  {game.vods.filter((v: {provider: string; parameter: string; locale: string}) => v.provider === "youtube").slice(0, 2).map((v: {provider: string; parameter: string; locale: string}, i: number) => (
                    <a
                      key={i}
                      href={`https://www.youtube.com/watch?v=${v.parameter}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--red)]/20 bg-[var(--red)]/5 px-3 py-1.5 text-[10px] font-medium text-[var(--red)] hover:bg-[var(--red)]/10 transition-colors"
                    >
                      <span>{"\u25B6"}</span>
                      VOD {v.locale?.split("-")[0]?.toUpperCase() || ""}
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* KC Players — gold accent */}
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <div className="h-3 w-1 rounded-full bg-[var(--gold)]" />
                <p className="text-xs font-semibold text-[var(--gold)] uppercase tracking-wider">Karmine Corp</p>
              </div>
              <div className="grid gap-1.5">
                {game.kc_players.filter((p) => p.name.startsWith("KC ")).map((p) => {
                  const cleanName = p.name.replace("KC ", "");
                  const killId = `${match.id}-${game.number}-${cleanName}`;
                  return (
                  <Link
                    key={p.name}
                    href={`/kill/${killId}`}
                    className="flex items-center gap-3 rounded-lg border-l-2 border-[var(--gold)]/30 bg-[var(--bg-primary)] p-2.5 hover:bg-[var(--bg-elevated)] hover:border-[var(--gold)] transition-all"
                  >
                    <Image src={championIconUrl(p.champion)} alt={p.champion} width={36} height={36}
                      className="rounded-full border border-[var(--gold)]/30" data-tooltip={p.champion} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[var(--gold)]">{cleanName}</p>
                      <p className="text-[10px] text-[var(--text-muted)]">{p.champion} &middot; {displayRole(p.role)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-data text-sm font-semibold">
                        <span className="text-[var(--green)]">{p.kills}</span>
                        /<span className="text-[var(--red)]">{p.deaths}</span>
                        /<span>{p.assists}</span>
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)]">{(p.gold / 1000).toFixed(1)}k &middot; {p.cs}CS &middot; Lv{p.level}</p>
                    </div>
                  </Link>
                  );
                })}
              </div>

              {/* Opponent Players — neutral */}
              <div className="flex items-center gap-2 mt-4 mb-2">
                <div className="h-3 w-1 rounded-full bg-[var(--text-disabled)]" />
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{match.opponent.name}</p>
              </div>
              <div className="grid gap-1.5">
                {game.opp_players.map((p) => (
                  <div key={p.name} className="flex items-center gap-3 rounded-lg border-l-2 border-transparent bg-[var(--bg-primary)]/60 p-2.5">
                    <Image src={championIconUrl(p.champion)} alt={p.champion} width={36} height={36}
                      className="rounded-full border border-[var(--border-gold)] opacity-70" data-tooltip={p.champion} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-[var(--text-secondary)]">{p.name.replace(/^[A-Z]+ /, "")}</p>
                      <p className="text-[10px] text-[var(--text-disabled)]">{p.champion} &middot; {displayRole(p.role)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-data text-sm text-[var(--text-muted)]">
                        <span>{p.kills}</span>/<span>{p.deaths}</span>/<span>{p.assists}</span>
                      </p>
                      <p className="text-[10px] text-[var(--text-muted)]">{(p.gold / 1000).toFixed(1)}k &middot; {p.cs}CS</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Real timeline (clickable dots positioned by game_time_seconds) ────

function RealKillTimeline({
  kills,
  maxGameTime,
  opponentCode,
}: {
  kills: PublishedKillRow[];
  maxGameTime: number;
  opponentCode: string;
}) {
  // Two-row layout: KC kills above the baseline, opponent kills below.
  // Reads at a glance whether the game was a KC stomp (gold cluster up
  // top) or a death train (red cluster on the bottom).
  const kcKills = kills.filter((k) => k.tracked_team_involvement === "team_killer");
  const oppKills = kills.filter((k) => k.tracked_team_involvement === "team_victim");

  // Tick marks every 5 minutes. Cap at 30 min — anything later collapses
  // into the rightmost tick so the strip doesn't get sparse on long games.
  const totalMinutes = Math.max(20, Math.ceil(maxGameTime / 60));
  const tickInterval = totalMinutes <= 25 ? 5 : 10;
  const ticks: number[] = [];
  for (let m = 0; m <= totalMinutes; m += tickInterval) ticks.push(m);

  return (
    <div className="relative h-20 select-none">
      {/* Tick marks (vertical, behind dots) */}
      {ticks.map((m) => {
        const leftPct = Math.min(100, ((m * 60) / maxGameTime) * 100);
        return (
          <div
            key={`t-${m}`}
            className="absolute top-2 bottom-2 w-px bg-white/[0.04] pointer-events-none"
            style={{ left: `${leftPct}%` }}
          >
            <span className="absolute -top-3 -translate-x-1/2 font-data text-[8px] uppercase tracking-widest text-white/30">
              {m}&apos;
            </span>
          </div>
        );
      })}

      {/* KC baseline (gold) */}
      <div className="absolute left-0 right-0 top-[calc(50%-14px)] h-px bg-[var(--gold)]/35" />
      {/* Opp baseline (red) */}
      <div className="absolute left-0 right-0 top-[calc(50%+14px)] h-px bg-[var(--red)]/35" />

      {/* KC dots (above) */}
      {kcKills.map((k) => {
        const t = k.game_time_seconds ?? 0;
        const leftPct = Math.max(0, Math.min(100, (t / maxGameTime) * 100));
        const title = `T+${formatGameTime(t)} \u2014 ${k.killer_champion} \u2192 ${k.victim_champion}${k.multi_kill ? ` (${k.multi_kill})` : ""}${k.is_first_blood ? " [first blood]" : ""}`;
        return (
          <Link
            key={k.id}
            href={`/kill/${k.id}`}
            className={`absolute top-[calc(50%-14px)] -translate-y-1/2 -translate-x-1/2 flex-shrink-0 transition-all hover:scale-150 hover:z-10 ${k.is_first_blood ? "animate-pulse" : ""}`}
            style={{ left: `${leftPct}%` }}
            title={title}
            aria-label={title}
          >
            <span
              className={`block rounded-full border-2 bg-[var(--gold)] border-[var(--gold)] shadow-[0_0_10px_rgba(200,170,110,0.7)] ${
                k.multi_kill
                  ? "h-4 w-4 ring-2 ring-[var(--gold)]/40"
                  : "h-3 w-3"
              }`}
            />
          </Link>
        );
      })}

      {/* Opp dots (below) */}
      {oppKills.map((k) => {
        const t = k.game_time_seconds ?? 0;
        const leftPct = Math.max(0, Math.min(100, (t / maxGameTime) * 100));
        const title = `T+${formatGameTime(t)} \u2014 ${k.killer_champion} \u2192 ${k.victim_champion}`;
        return (
          <Link
            key={k.id}
            href={`/kill/${k.id}`}
            className="absolute top-[calc(50%+14px)] -translate-y-1/2 -translate-x-1/2 flex-shrink-0 transition-all hover:scale-150 hover:z-10"
            style={{ left: `${leftPct}%` }}
            title={title}
            aria-label={title}
          >
            <span className="block h-3 w-3 rounded-full border-2 bg-[var(--red)]/80 border-[var(--red)]/60" />
          </Link>
        );
      })}

      {/* Side labels — left edge */}
      <div className="absolute left-0 top-0 bottom-0 flex flex-col justify-between text-[8px] font-data uppercase tracking-widest pointer-events-none pl-1">
        <span className="text-[var(--gold)]/65">KC</span>
        <span className="text-[var(--red)]/65">{opponentCode}</span>
      </div>

      <div className="sr-only">
        Timeline of {kills.length} kills, {kcKills.length} by KC and {oppKills.length} by {opponentCode}.
      </div>
    </div>
  );
}

// ─── Aggregate dots (fallback when no real clips exist yet) ────────────

function AggregateDots({
  kcKills,
  oppKills,
  opponentCode,
}: {
  kcKills: number;
  oppKills: number;
  opponentCode: string;
}) {
  const total = kcKills + oppKills;
  if (total === 0) {
    return <p className="text-[10px] text-[var(--text-disabled)]">Pas de kills enregistr&eacute;s</p>;
  }
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {Array.from({ length: total }).map((_, i) => {
        const isKc = i < kcKills;
        return (
          <div
            key={i}
            className={`h-3 w-3 rounded-full flex-shrink-0 transition-transform hover:scale-150 ${
              isKc ? "bg-[var(--gold)]" : "bg-[var(--red)]/60"
            }`}
            title={isKc ? `KC kill #${i + 1}` : `${opponentCode} kill #${i - kcKills + 1}`}
          />
        );
      })}
    </div>
  );
}
