import { notFound } from "next/navigation";
import { loadRealData, getPlayerStats } from "@/lib/real-data";
import { championSplashUrl, championLoadingUrl, championIconUrl } from "@/lib/constants";
import { PLAYER_PHOTOS } from "@/lib/kc-assets";
import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";
import { MatchHistory } from "./match-history";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ slug: string }>;
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

  return (
    <div className="-mx-4 -mt-6">
      {/* ═══ HERO — full-screen cinematic ═══ */}
      <section className="relative h-[90vh] min-h-[720px] w-full overflow-hidden">
        {/* Champion loading art as vertical background */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={championLoadingUrl(signatureChamp)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover scale-110"
          style={{ filter: "brightness(0.45) saturate(1.1)" }}
        />
        {/* Splash as second layer, blurred */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={championSplashUrl(signatureChamp)}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-30 scale-105 blur-2xl"
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
          <span className="text-[10px] uppercase tracking-[0.3em]">Clips</span>
          <svg className="h-4 w-4 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </div>
      </section>

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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={championLoadingUrl(m.champion)}
                    alt={m.champion}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-700"
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={championLoadingUrl(c.name)}
                    alt={c.name}
                    className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
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
