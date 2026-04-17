import { notFound } from "next/navigation";
import { loadRealData, getPlayerStats, type RealData } from "@/lib/real-data";
import { championSplashUrl, championLoadingUrl, championIconUrl } from "@/lib/constants";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import { PortraitCubeMorph } from "@/components/PortraitCubeMorph";
import { ClipReel } from "@/components/ClipReel";
import { getPlayerByIgn } from "@/lib/supabase/players";
import {
  getKillsByKillerChampion,
  type PublishedKillRow,
} from "@/lib/supabase/kills";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { MatchHistory } from "./match-history";
import {
  PlayerRadar,
  ChampionPerformanceChart,
  RecentFormChart,
} from "@/components/PlayerCharts";
import { getQuotesByPlayer } from "@/lib/quotes";
import { QuoteRow } from "@/components/QuoteCard";

export const revalidate = 300;

interface Props {
  params: Promise<{ slug: string }>;
}

/**
 * Fetch the real published kills that belong to this player.
 *
 * We don't have a `killer_player_id` FK populated on kills yet, so we use
 * a proxy: for each of the player's top champions, pull Supabase kills on
 * that champion, then filter to only keep rows where the match+game in our
 * static JSON shows THIS player playing THAT champion. This is tight enough
 * for KC players in 2025-2026 where each role rarely shares champions.
 */
async function getRealKillsForPlayer(
  playerCleanName: string,
  topChampions: { name: string }[],
  data: RealData,
): Promise<PublishedKillRow[]> {
  if (topChampions.length === 0) return [];

  // Pull candidate rows for each champion (max 5 champions to keep egress light)
  const championNames = topChampions.slice(0, 5).map((c) => c.name);
  const perChampion = await Promise.all(
    championNames.map((c) => getKillsByKillerChampion(c, 20)),
  );

  // Dedupe by kill id
  const seen = new Set<string>();
  const candidates: PublishedKillRow[] = [];
  for (const batch of perChampion) {
    for (const k of batch) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      candidates.push(k);
    }
  }

  // Tight filter: same match + same game + same champion picked by this player
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

function formatGameTime(seconds: number | null): string {
  if (seconds == null) return "??:??";
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
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
      ? `${name} \u2014 Karmine Corp \u00b7 ${stats.gamesPlayed} games, ${stats.kills} kills, KDA ${stats.kda}. Explore les meilleurs moments et stats du joueur sur KCKILLS.`
      : `${name} \u2014 Profil Karmine Corp sur KCKILLS.`;

  return {
    title: name,
    description,
    alternates: { canonical: canonicalPath },
    openGraph: {
      title: `${name} \u2014 KCKILLS`,
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
      title: `${name} \u2014 KCKILLS`,
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
  const topChampions = stats.champions.slice(0, 8);

  // Cube-morph palette — the player's official KC photo (when known) gets
  // top billing, then their top champion splashes morph behind. Falls back
  // to splash-only when the photo is missing so the hero still feels alive.
  const playerPhoto = PLAYER_PHOTOS[name];
  const morphImages = [
    ...(playerPhoto ? [playerPhoto] : []),
    ...stats.champions.slice(0, 5).map((c) => championSplashUrl(c.name)),
  ];
  if (morphImages.length === 0) morphImages.push(championSplashUrl(signatureChamp));

  // Real kills from Supabase pipeline (legacy champion-proxy path —
  // still used as a fallback for the "champion pool" matrix below).
  const realKills = await getRealKillsForPlayer(name, stats.champions, data);

  // Resolve the player's UUID once so the clip-centric ClipReel can fetch
  // a clean slice via killer_player_id (the canonical filter, populated
  // by worker/scripts/backfill_player_ids.py). Falls back to null if the
  // backfill hasn't run yet — the reel then renders its empty state.
  const playerRow = await getPlayerByIgn(name);
  const playerId = playerRow?.id ?? null;

  // Best clips = highest KDA games
  const bestClips = [...stats.matchHistory]
    .sort((a, b) => {
      const kdaA = a.deaths > 0 ? (a.kills + a.assists) / a.deaths : (a.kills + a.assists) * 2;
      const kdaB = b.deaths > 0 ? (b.kills + b.assists) / b.deaths : (b.kills + b.assists) * 2;
      return kdaB - kdaA;
    })
    .slice(0, 6);

  const winRate = stats.matchHistory.length
    ? Math.round(
        (stats.matchHistory.filter((m) => m.won).length / stats.matchHistory.length) * 100
      )
    : 0;

  // Try to use a custom Hextech background for this player (generated with
  // Gemini). Falls back to the champion loading art if no custom bg exists.
  const customBg = `/images/players/player-bg-${name.toLowerCase()}.jpg`;

  return (
    <div
      className="-mt-6"
      style={{
        // Full-bleed to escape the parent <main max-w-7xl> container
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* ═══ HERO — full-screen cinematic with cube-portrait morph ═══ */}
      <section className="relative h-[90vh] min-h-[720px] w-full overflow-hidden bg-[var(--bg-primary)]">
        {/* Soft champion-art backdrop — heavily darkened so the dot-matrix
            cubes paint themselves on top with full saturation. */}
        <Image
          src={championLoadingUrl(signatureChamp)}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover scale-110"
          style={{ filter: "brightness(0.22) saturate(1.15)" }}
        />
        {/* Optional Hextech Gemini accent — kept very subtle so it doesn't
            fight the morph (renders as ambient depth, 404s silently). */}
        <Image
          src={customBg}
          alt=""
          fill
          sizes="100vw"
          className="object-cover scale-105 mix-blend-overlay"
          style={{ filter: "brightness(0.7) saturate(1.05)", opacity: 0.55 }}
        />

        {/* Cube-portrait morph — cycles between the player's official photo
            and their signature champion splashes, dot-matrix style. */}
        <PortraitCubeMorph
          images={morphImages}
          accent="#C8AA6E"
          cols={68}
          aspect={9 / 16}
          holdMs={5800}
          morphMs={2100}
          className="absolute inset-0 mix-blend-screen opacity-95"
        />

        {/* Dark vignettes */}
        <div className="absolute inset-0 bg-gradient-to-t from-[var(--bg-primary)] via-[var(--bg-primary)]/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--bg-primary)] via-transparent to-[var(--bg-primary)]/70" />

        {/* Gold accent gradient */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 50% 60% at 20% 50%, rgba(200,170,110,0.15) 0%, transparent 60%)",
          }}
        />

        {/* Scanlines */}
        <div
          className="absolute inset-0 opacity-15 mix-blend-overlay pointer-events-none"
          style={{
            backgroundImage:
              "repeating-linear-gradient(180deg, transparent 0px, transparent 2px, rgba(200,170,110,0.1) 3px, transparent 4px)",
          }}
        />

        {/* Breadcrumb */}
        <nav className="absolute top-6 left-6 z-20 flex items-center gap-2 text-xs text-white/50">
          <Link href="/" className="hover:text-[var(--gold)]">
            Accueil
          </Link>
          <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
          <Link href="/players" className="hover:text-[var(--gold)]">
            Joueurs
          </Link>
          <span className="text-[var(--gold)]/30">{"\u25C6"}</span>
          <span className="text-[var(--gold)]">{name}</span>
        </nav>

        {/* Player photo — giant, right side */}
        {photo && (
          <div className="absolute bottom-0 right-0 h-[95%] w-[55%] md:w-[45%] lg:w-[40%] z-10 pointer-events-none">
            <Image
              src={photo}
              alt={name}
              fill
              priority
              className="object-contain object-bottom"
              style={{
                filter: "drop-shadow(0 20px 80px rgba(200,170,110,0.25))",
              }}
            />
            {/* Gold accent line behind player */}
            <div
              className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[80%] h-2 rounded-full blur-2xl opacity-60"
              style={{
                background:
                  "linear-gradient(90deg, transparent, var(--gold), transparent)",
              }}
            />
          </div>
        )}

        {/* Content — left side */}
        <div className="relative z-20 h-full max-w-7xl mx-auto flex flex-col justify-end px-6 pb-16">
          {/* Team tag */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            <span className="rounded-md px-3 py-1 font-data text-[11px] font-bold tracking-[0.2em] uppercase backdrop-blur-sm border border-[var(--gold)]/40 bg-[var(--gold)]/10 text-[var(--gold)]">
              Karmine Corp
            </span>
            {stats.matchHistory.length > 0 && (
              <span className="font-data text-xs text-white/50 tracking-[0.2em] uppercase">
                {stats.matchHistory[stats.matchHistory.length - 1]?.date.slice(0, 4)} &mdash;{" "}
                {stats.matchHistory[0]?.date.slice(0, 4)}
              </span>
            )}
          </div>

          {/* Massive name */}
          <h1
            className="font-display font-black leading-[0.85] text-7xl md:text-9xl lg:text-[11rem] text-white"
            style={{
              textShadow:
                "0 0 60px rgba(200,170,110,0.25), 0 6px 40px rgba(0,0,0,0.8)",
            }}
          >
            {name.toUpperCase()}
          </h1>

          {/* Big KDA with label */}
          <div className="flex items-end gap-8 mt-8 flex-wrap">
            <div>
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-white/40 mb-1">
                KDA ratio
              </p>
              <p
                className="font-data text-6xl md:text-7xl font-black leading-none"
                style={{
                  color: "var(--gold)",
                  textShadow: "0 0 40px rgba(200,170,110,0.4)",
                }}
              >
                {stats.kda}
              </p>
            </div>
            <div className="h-16 w-px bg-white/10" />
            <div>
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-white/40 mb-1">
                Games
              </p>
              <p className="font-data text-4xl md:text-5xl font-black text-white leading-none">
                {stats.gamesPlayed}
              </p>
            </div>
            <div className="h-16 w-px bg-white/10" />
            <div>
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-white/40 mb-1">
                Winrate
              </p>
              <p
                className="font-data text-4xl md:text-5xl font-black leading-none"
                style={{ color: winRate >= 50 ? "var(--green)" : "var(--red)" }}
              >
                {winRate}%
              </p>
            </div>
            <div className="h-16 w-px bg-white/10" />
            <div>
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-white/40 mb-1">
                K / D / A moyens
              </p>
              <p className="font-data text-2xl md:text-3xl font-black leading-none">
                <span className="text-[var(--green)]">{stats.avgKills}</span>
                <span className="text-white/30 mx-1">/</span>
                <span className="text-[var(--red)]">{stats.avgDeaths}</span>
                <span className="text-white/30 mx-1">/</span>
                <span className="text-white">{stats.avgAssists}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Scroll hint */}
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-2 text-white/30">
          <span className="text-[10px] uppercase tracking-[0.3em]">Analytics</span>
          <svg className="h-4 w-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

      {/* ═══ ANALYTICS CHARTS ═══ */}
      <section className="relative max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-center gap-3 mb-8">
          <span className="h-px w-12 bg-[var(--gold)]" />
          <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
            Analytics
          </span>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          {/* Radar — player strengths */}
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

          {/* Champion performance */}
          <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
            <h3 className="font-display text-sm font-bold mb-4 text-[var(--text-secondary)]">
              Champions &middot; games jou&eacute;es
            </h3>
            <ChampionPerformanceChart champions={stats.champions} />
          </div>

          {/* Recent form */}
          <div className="rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-5">
            <h3 className="font-display text-sm font-bold mb-4 text-[var(--text-secondary)]">
              Forme r&eacute;cente &middot; KDA par match
            </h3>
            <RecentFormChart history={stats.matchHistory} />
          </div>
        </div>
      </section>

      {/* ═══ CLIP-CENTRIC REELS — driven by killer/victim_player_id ═══ */}
      {playerId && (
        <section className="relative max-w-7xl mx-auto px-6 py-16 space-y-12">
          {/* Top kills BY this player */}
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

          {/* Carry games — kills with first blood, multi-kill or 8+ score */}
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

          {/* Kills suffered — what got this player picked off */}
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

      {/* ═══ REAL KILL CLIPS (legacy champion-proxy fallback) ═══
          Kept for backwards compatibility while the killer_player_id
          backfill rolls out — drop once the new reels reach 100% coverage. */}
      {!playerId && realKills.length > 0 && (
        <section className="relative max-w-7xl mx-auto px-6 py-20">
          <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="h-2 w-2 rounded-full bg-[var(--gold)] animate-pulse" />
              <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
                {realKills.length} clips vid&eacute;o
              </span>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              G&eacute;n&eacute;r&eacute;s par le pipeline automatique &middot; vrais highlights
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {realKills.slice(0, 6).map((k) => {
              const isKcKill = k.tracked_team_involvement === "team_killer";
              return (
                <Link
                  key={k.id}
                  href={`/kill/${k.id}`}
                  className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-black transition-all hover:border-[var(--gold)]/60 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-2xl hover:shadow-[var(--gold)]/20"
                  style={{ aspectRatio: "16/10" }}
                >
                  {k.thumbnail_url ? (
                    <Image
                      src={k.thumbnail_url}
                      alt={`${k.killer_champion} vs ${k.victim_champion}`}
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover group-hover:scale-110 transition-transform duration-700"
                    />
                  ) : (
                    <Image
                      src={championSplashUrl(k.killer_champion ?? "Aatrox")}
                      alt=""
                      fill
                      sizes="(max-width: 768px) 100vw, 33vw"
                      className="object-cover opacity-40"
                    />
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />

                  {/* Badges */}
                  <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
                    {k.highlight_score != null && (
                      <span className="rounded-md bg-[var(--gold)]/20 backdrop-blur-sm border border-[var(--gold)]/40 px-2 py-0.5 text-[10px] font-data font-bold text-[var(--gold)]">
                        {k.highlight_score.toFixed(1)}/10
                      </span>
                    )}
                    {k.is_first_blood && (
                      <span className="rounded-md bg-[var(--red)]/20 border border-[var(--red)]/40 px-2 py-0.5 text-[10px] font-black text-[var(--red)]">
                        FB
                      </span>
                    )}
                    {k.multi_kill && (
                      <span className="rounded-md bg-[var(--gold)]/20 border border-[var(--gold)]/40 px-2 py-0.5 text-[10px] font-black text-[var(--gold)] uppercase">
                        {k.multi_kill}
                      </span>
                    )}
                  </div>

                  <div className="absolute bottom-0 left-0 right-0 p-4 z-10">
                    <div className="flex items-center gap-2 mb-2">
                      <Image
                        src={championIconUrl(k.killer_champion ?? "Aatrox")}
                        alt={k.killer_champion ?? "?"}
                        width={28}
                        height={28}
                        className="rounded-full border border-[var(--gold)]/30"
                      />
                      <span className={`font-display text-lg font-black ${isKcKill ? "text-[var(--gold)]" : "text-white"}`}>
                        {k.killer_champion}
                      </span>
                      <span className="text-[var(--gold)] text-sm">&rarr;</span>
                      <Image
                        src={championIconUrl(k.victim_champion ?? "Aatrox")}
                        alt={k.victim_champion ?? "?"}
                        width={28}
                        height={28}
                        className="rounded-full border border-[var(--red)]/30"
                      />
                      <span className="font-display text-lg font-black text-white/80">
                        {k.victim_champion}
                      </span>
                    </div>
                    {k.ai_description && (
                      <p className="text-[11px] text-white/80 italic line-clamp-2">
                        &laquo; {k.ai_description} &raquo;
                      </p>
                    )}
                    <p className="text-[9px] text-[var(--text-muted)] mt-1.5">
                      T+{formatGameTime(k.game_time_seconds)} &middot; Game {k.games?.game_number ?? "?"}
                    </p>
                  </div>

                  {/* Hover play */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none">
                    <div className="h-14 w-14 rounded-full bg-[var(--gold)]/20 backdrop-blur-md border border-[var(--gold)]/50 flex items-center justify-center">
                      <svg className="h-5 w-5 text-[var(--gold)] translate-x-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {realKills.length > 6 && (
            <div className="text-center mt-6">
              <Link
                href="/scroll"
                className="inline-flex items-center gap-2 rounded-xl border border-[var(--gold)]/30 bg-[var(--gold)]/10 px-5 py-2.5 text-xs font-display font-bold uppercase tracking-widest text-[var(--gold)] hover:bg-[var(--gold)]/20 transition-colors"
              >
                Voir les {realKills.length - 6} autres dans le scroll
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                </svg>
              </Link>
            </div>
          )}
        </section>
      )}

      {/* ═══ BEST CLIPS — massive cinematic grid ═══ */}
      {bestClips.length > 0 && (
        <section className="relative max-w-7xl mx-auto px-6 py-20">
          <div className="flex items-center justify-between mb-8 flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <span className="h-px w-12 bg-[var(--gold)]" />
              <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
                Meilleurs moments
              </span>
            </div>
            <p className="text-sm text-[var(--text-muted)]">
              Tri&eacute;s par KDA &middot; clique pour voir le match
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {bestClips.map((m, i) => {
              const kda =
                m.deaths > 0
                  ? ((m.kills + m.assists) / m.deaths).toFixed(1)
                  : "Perfect";
              return (
                <Link
                  key={`best-${m.matchId}-${i}`}
                  href={`/match/${m.matchId}`}
                  className="group relative overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/60 hover:scale-[1.02] hover:-translate-y-1 hover:shadow-2xl hover:shadow-[var(--gold)]/20"
                  style={{ aspectRatio: "4/5" }}
                >
                  {/* Full champion splash */}
                  <Image
                    src={championLoadingUrl(m.champion)}
                    alt={m.champion}
                    fill
                    sizes="(max-width: 768px) 100vw, 33vw"
                    className="object-cover group-hover:scale-110 transition-transform duration-700"
                  />
                  {/* Gradient */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black/60" />

                  {/* Rank badge top left */}
                  {i < 3 && (
                    <div className="absolute top-4 left-4 z-10">
                      <div
                        className="flex h-10 w-10 items-center justify-center rounded-full font-display text-lg font-black text-black"
                        style={{
                          background:
                            i === 0
                              ? "linear-gradient(135deg, #FFD700, #FFA500)"
                              : i === 1
                              ? "linear-gradient(135deg, #C0C0C0, #909090)"
                              : "linear-gradient(135deg, #CD7F32, #8B4513)",
                          boxShadow:
                            i === 0
                              ? "0 0 30px rgba(255,215,0,0.5)"
                              : i === 1
                              ? "0 0 20px rgba(192,192,192,0.4)"
                              : "0 0 20px rgba(205,127,50,0.4)",
                        }}
                      >
                        {i + 1}
                      </div>
                    </div>
                  )}

                  {/* W/L badge top right */}
                  <div className="absolute top-4 right-4 z-10">
                    <span
                      className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-widest backdrop-blur-sm border ${
                        m.won
                          ? "bg-[var(--green)]/20 border-[var(--green)]/40 text-[var(--green)]"
                          : "bg-[var(--red)]/20 border-[var(--red)]/40 text-[var(--red)]"
                      }`}
                    >
                      {m.won ? "W" : "L"}
                    </span>
                  </div>

                  {/* Bottom content */}
                  <div className="absolute bottom-0 left-0 right-0 p-5 z-10">
                    {/* Champion name */}
                    <p className="font-display text-3xl font-black text-white leading-none mb-1">
                      {m.champion}
                    </p>
                    <p className="text-xs text-white/50 uppercase tracking-wider mb-4">
                      vs {m.opponent} &middot;{" "}
                      {new Date(m.date).toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </p>

                    {/* KDA row */}
                    <div className="flex items-end justify-between">
                      <div className="font-data">
                        <span className="text-2xl font-black text-[var(--green)]">
                          {m.kills}
                        </span>
                        <span className="text-white/30 mx-1">/</span>
                        <span className="text-2xl font-black text-[var(--red)]">
                          {m.deaths}
                        </span>
                        <span className="text-white/30 mx-1">/</span>
                        <span className="text-2xl font-black text-white">
                          {m.assists}
                        </span>
                      </div>
                      <div
                        className="font-data text-3xl font-black"
                        style={{
                          color: "var(--gold)",
                          textShadow: "0 0 20px rgba(200,170,110,0.4)",
                        }}
                      >
                        {kda}
                      </div>
                    </div>
                  </div>

                  {/* Hover play indicator */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-all duration-300 pointer-events-none">
                    <div className="h-16 w-16 rounded-full bg-[var(--gold)]/20 backdrop-blur-md border border-[var(--gold)]/50 flex items-center justify-center">
                      <svg
                        className="h-6 w-6 text-[var(--gold)] translate-x-0.5"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* ═══ QUOTES ═══ */}
      {(() => {
        const quotes = getQuotesByPlayer(name);
        if (quotes.length === 0) return null;
        return (
          <section className="relative max-w-7xl mx-auto px-6 py-16">
            <div className="flex items-center gap-3 mb-6">
              <span className="h-px w-12 bg-[var(--gold)]" />
              <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
                Citations
              </span>
            </div>
            <QuoteRow quotes={quotes} />
          </section>
        );
      })()}

      {/* ═══ CHAMPION POOL — horizontal strip ═══ */}
      {topChampions.length > 0 && (
        <section className="relative max-w-7xl mx-auto px-6 py-16">
          <div className="flex items-center gap-3 mb-6">
            <span className="h-px w-12 bg-[var(--gold)]" />
            <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
              Champion pool &middot; {stats.champions.length} champions
            </span>
          </div>

          <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-8">
            {topChampions.map((c) => {
              const kda =
                c.deaths > 0
                  ? ((c.kills + c.assists) / c.deaths).toFixed(1)
                  : "Perfect";
              return (
                <div
                  key={c.name}
                  className="group relative aspect-square overflow-hidden rounded-2xl border border-[var(--border-gold)] bg-[var(--bg-surface)] transition-all hover:border-[var(--gold)]/50 hover:scale-105"
                >
                  <Image
                    src={championLoadingUrl(c.name)}
                    alt={c.name}
                    fill
                    sizes="(max-width: 768px) 50vw, 12vw"
                    className="object-cover group-hover:scale-110 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />

                  {/* Games pill top right */}
                  <div className="absolute top-2 right-2 z-10 rounded-md bg-black/60 backdrop-blur-sm px-2 py-0.5 border border-white/10">
                    <span className="font-data text-[10px] font-bold text-white">
                      {c.games}G
                    </span>
                  </div>

                  {/* Bottom */}
                  <div className="absolute bottom-0 left-0 right-0 p-3 z-10">
                    <p className="font-display text-sm font-bold text-white leading-tight truncate">
                      {c.name}
                    </p>
                    <div className="flex items-center justify-between mt-1">
                      <span className="font-data text-[10px] text-white/60">
                        {c.kills}/{c.deaths}/{c.assists}
                      </span>
                      <span className="font-data text-[11px] font-bold text-[var(--gold)]">
                        {kda}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {stats.champions.length > 8 && (
            <details className="mt-6">
              <summary className="cursor-pointer text-center text-xs text-[var(--text-muted)] hover:text-[var(--gold)] uppercase tracking-[0.2em]">
                Voir les {stats.champions.length - 8} autres champions
              </summary>
              <div className="mt-4 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                {stats.champions.slice(8).map((c) => {
                  const kda =
                    c.deaths > 0
                      ? ((c.kills + c.assists) / c.deaths).toFixed(1)
                      : "Perfect";
                  return (
                    <div
                      key={c.name}
                      className="flex items-center gap-3 rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] p-3"
                    >
                      <Image
                        src={championIconUrl(c.name)}
                        alt={c.name}
                        width={36}
                        height={36}
                        className="rounded-full border border-[var(--border-gold)]"
                      />
                      <div className="flex-1">
                        <p className="font-medium text-sm">{c.name}</p>
                        <p className="text-[10px] text-[var(--text-muted)]">
                          {c.games} games
                        </p>
                      </div>
                      <span className="font-data text-sm font-bold text-[var(--gold)]">
                        {kda}
                      </span>
                    </div>
                  );
                })}
              </div>
            </details>
          )}
        </section>
      )}

      {/* ═══ MATCH HISTORY ═══ */}
      <section className="relative max-w-7xl mx-auto px-6 py-16">
        <div className="flex items-center gap-3 mb-6">
          <span className="h-px w-12 bg-[var(--gold)]" />
          <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
            Historique complet
          </span>
        </div>
        <MatchHistory history={stats.matchHistory} />
      </section>
    </div>
  );
}
