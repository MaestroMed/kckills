"use client";

/**
 * KillCinematicView — award-grade clip detail page.
 *
 * Replaces the old "card stack" layout with a cinematic single-screen
 * presentation : the clip is the hero, surrounded by killer/victim
 * splash backdrops + a duel header that asserts the moment. Below the
 * fold, a stat strip + match context + interactions sit in a calmer
 * typographic rhythm.
 *
 * Design principles applied :
 *   * One commanding hero, no "card stack"
 *   * Champion splash arts as ambient backdrop (15% opacity, blurred)
 *   * Centered duel header : killer ⚔ victim with animated arrow
 *   * Cinematic letterbox frame on the clip player
 *   * Typography : Cinzel for the matchup line, Fira Sans for body,
 *     Space Mono for numbers — same fonts as the rest of the site, just
 *     given more breathing room
 *   * Subtle gold particle drift in the hero (CSS-only, no JS)
 *   * Reduced motion respected via prefers-reduced-motion
 *
 * Why client component : the hero animations + the small video
 * "scrubber" hover state need useEffect / state. The parent page.tsx
 * stays a Server Component — it pre-loads kill data + JSON-LD then
 * hands the heavy bits to this island.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { championIconUrl } from "@/lib/constants";

interface CinematicKillProps {
  kill: {
    id: string;
    killer_champion: string | null;
    victim_champion: string | null;
    killer_name?: string | null;
    victim_name?: string | null;
    clip_url_horizontal?: string | null;
    clip_url_vertical?: string | null;
    thumbnail_url?: string | null;
    ai_description?: string | null;
    ai_tags?: string[] | null;
    highlight_score?: number | null;
    avg_rating?: number | null;
    rating_count?: number | null;
    comment_count?: number | null;
    impression_count?: number | null;
    multi_kill?: string | null;
    is_first_blood?: boolean | null;
    tracked_team_involvement?: string | null;
    game_time_seconds?: number | null;
    created_at?: string | null;
    games?: {
      game_number?: number | null;
      matches?: {
        external_id?: string | null;
        scheduled_at?: string | null;
        stage?: string | null;
      } | null;
    } | null;
  };
  opponent: { code: string; name: string };
  /** Slot for the InlineAuth + comments + rate components rendered server-side
   *  by the parent page (kept here as `children` so the cinematic shell
   *  stays presentation-only and the parent owns auth wiring).
   */
  children?: React.ReactNode;
  /** Optional list of "other kills from this match" to surface in the carousel
   *  at the bottom of the page. Rendered as small thumbnail tiles.
   */
  relatedKills?: Array<{
    id: string;
    killer_champion: string | null;
    victim_champion: string | null;
    thumbnail_url: string | null;
    highlight_score: number | null;
    multi_kill: string | null;
    is_first_blood: boolean | null;
  }>;
  /** Optional server-rendered slot for the AI-similarity carousel.
   *  PR17 — server component (SimilarClipsCarousel) is rendered by the
   *  parent page and threaded through as a ReactNode so this client
   *  island doesn't need to await Supabase itself. */
  similarSlot?: React.ReactNode;
}

const CHAMPION_SPLASH = (champion: string | null | undefined): string =>
  `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${champion || "Aatrox"}_0.jpg`;

export function KillCinematicView({
  kill,
  opponent,
  children,
  relatedKills = [],
  similarSlot,
}: CinematicKillProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  const isKcKill = kill.tracked_team_involvement === "team_killer";
  const gameTime = kill.game_time_seconds ?? 0;
  const gtMin = Math.floor(gameTime / 60);
  const gtSec = gameTime % 60;
  const matchExternalId = kill.games?.matches?.external_id ?? "";
  const matchScheduled = kill.games?.matches?.scheduled_at ?? kill.created_at;
  const stage = kill.games?.matches?.stage ?? "LEC";
  const gameNumber = kill.games?.game_number ?? 1;
  const clipSrc = kill.clip_url_horizontal ?? kill.clip_url_vertical ?? undefined;

  const killerChamp = kill.killer_champion ?? "Aatrox";
  const victimChamp = kill.victim_champion ?? "Aatrox";

  // Custom progress tracking — the native <video> controls are visually
  // heavy on a cinematic page; we replace them with a thin gold scrubber.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (v.duration > 0) setProgress((v.currentTime / v.duration) * 100);
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, []);

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  return (
    <div
      className="relative -mt-6"
      style={{
        width: "100vw",
        position: "relative",
        left: "50%",
        right: "50%",
        marginLeft: "-50vw",
        marginRight: "-50vw",
      }}
    >
      {/* ─── HERO ─────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        {/* Splash backdrop — split screen killer/victim */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute inset-y-0 left-0 right-1/2 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={CHAMPION_SPLASH(killerChamp)}
              alt=""
              className="h-full w-full object-cover scale-110 opacity-25 blur-md"
              style={{ transform: "scale(1.15) translateX(-2%)" }}
            />
          </div>
          <div className="absolute inset-y-0 left-1/2 right-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={CHAMPION_SPLASH(victimChamp)}
              alt=""
              className="h-full w-full object-cover scale-110 opacity-25 blur-md"
              style={{ transform: "scale(1.15) translateX(2%)" }}
            />
          </div>
          {/* Gradient overlay : darken edges, keep center luminous */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 80% 70% at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.6) 70%, rgba(1,10,19,0.95) 100%)",
            }}
          />
          {/* Hextech vertical wash */}
          <div
            className="absolute inset-x-0 top-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(200,170,110,0.6), transparent)",
            }}
          />
          {/* Gold particle drift (CSS only, ~12 dots, GPU-cheap) */}
          <div className="kc-particles absolute inset-0 pointer-events-none">
            {Array.from({ length: 14 }).map((_, i) => (
              <span
                key={i}
                className="absolute h-px w-px rounded-full bg-[var(--gold)]/60"
                style={{
                  left: `${(i * 73) % 100}%`,
                  top: `${(i * 41) % 100}%`,
                  animation: `kc-float ${10 + (i % 5) * 3}s linear ${i * 0.7}s infinite`,
                }}
              />
            ))}
          </div>
        </div>

        <style>{`
          @keyframes kc-float {
            0%   { transform: translateY(0)    scale(1);   opacity: 0; }
            10%  { opacity: 0.8; }
            50%  { transform: translateY(-40vh) scale(1.6); opacity: 1; }
            90%  { opacity: 0.4; }
            100% { transform: translateY(-80vh) scale(0.8); opacity: 0; }
          }
          @keyframes kc-arrow-pulse {
            0%, 100% { transform: translateX(0)    scale(1);   filter: drop-shadow(0 0 0 rgba(200,170,110,0)); }
            50%      { transform: translateX(4px) scale(1.08); filter: drop-shadow(0 0 12px rgba(200,170,110,0.7)); }
          }
          @keyframes kc-shimmer-text {
            0%   { background-position: -100% 0; }
            100% { background-position:  200% 0; }
          }
          @media (prefers-reduced-motion: reduce) {
            .kc-particles span { animation: none !important; opacity: 0 !important; }
          }
        `}</style>

        {/* Content */}
        <div className="relative z-10 max-w-6xl mx-auto px-6 pt-10 pb-14 md:pt-14 md:pb-20">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <Link href="/" className="hover:text-[var(--gold)] transition-colors">Accueil</Link>
            <span className="text-[var(--gold)]/40">{"\u25C6"}</span>
            {matchExternalId ? (
              <Link href={`/match/${matchExternalId}`} className="hover:text-[var(--gold)] transition-colors">
                KC vs {opponent.code}
              </Link>
            ) : (
              <span>KC vs {opponent.code}</span>
            )}
            <span className="text-[var(--gold)]/40">{"\u25C6"}</span>
            <span>Game {gameNumber}</span>
          </nav>

          {/* Duel header */}
          <div className="mt-8 flex flex-col items-center gap-5 md:gap-7">
            {/* Kicker line */}
            <p className="font-data text-[10px] uppercase tracking-[0.4em] text-[var(--gold)]/80">
              {kill.is_first_blood && "★ First Blood · "}
              {kill.multi_kill ? `★ ${kill.multi_kill.toUpperCase()} KILL · ` : ""}
              {isKcKill ? "Karmine Corp prend le kill" : "Karmine Corp encaisse"}
            </p>

            <div className="flex items-center gap-4 md:gap-7">
              {/* Killer */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`relative overflow-hidden rounded-2xl border-2 ${
                    isKcKill ? "border-[var(--gold)]" : "border-white/30"
                  }`}
                  style={{
                    boxShadow: isKcKill
                      ? "0 0 32px rgba(200,170,110,0.35), inset 0 0 8px rgba(200,170,110,0.2)"
                      : "0 0 16px rgba(255,255,255,0.08)",
                  }}
                >
                  <Image
                    src={championIconUrl(killerChamp)}
                    alt={killerChamp}
                    width={104}
                    height={104}
                    priority
                  />
                </div>
                <div className="text-center">
                  <p className={`font-display text-base md:text-lg font-black ${isKcKill ? "text-[var(--gold)]" : "text-white"}`}>
                    {kill.killer_name || killerChamp}
                  </p>
                  <p className="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                    {killerChamp}
                  </p>
                </div>
              </div>

              {/* Centerpiece — animated arrow */}
              <div className="flex flex-col items-center gap-1.5">
                <svg
                  className="h-9 w-9 md:h-12 md:w-12 text-[var(--gold)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  style={{ animation: "kc-arrow-pulse 2.4s ease-in-out infinite" }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14M13 5l7 7-7 7" />
                </svg>
                <span className="font-data text-[10px] md:text-xs font-bold tracking-widest text-[var(--text-muted)]">
                  T+{gtMin.toString().padStart(2, "0")}:{gtSec.toString().padStart(2, "0")}
                </span>
              </div>

              {/* Victim */}
              <div className="flex flex-col items-center gap-2">
                <div
                  className={`relative overflow-hidden rounded-2xl border-2 ${
                    !isKcKill ? "border-[var(--gold)]" : "border-[var(--red)]/60"
                  }`}
                  style={{
                    boxShadow: !isKcKill
                      ? "0 0 32px rgba(200,170,110,0.35)"
                      : "0 0 22px rgba(232,64,87,0.25)",
                  }}
                >
                  <Image
                    src={championIconUrl(victimChamp)}
                    alt={victimChamp}
                    width={104}
                    height={104}
                  />
                </div>
                <div className="text-center">
                  <p className={`font-display text-base md:text-lg font-black ${!isKcKill ? "text-[var(--gold)]" : "text-white"}`}>
                    {kill.victim_name || victimChamp}
                  </p>
                  <p className="text-[9px] uppercase tracking-widest text-[var(--text-muted)]">
                    {victimChamp}
                  </p>
                </div>
              </div>
            </div>

            {/* Score chip */}
            {kill.highlight_score != null && (
              <div className="flex items-center gap-3">
                <span
                  className="font-data text-[11px] uppercase tracking-widest text-transparent bg-clip-text"
                  style={{
                    backgroundImage:
                      "linear-gradient(90deg, var(--gold-dark), var(--gold-bright), var(--gold-dark))",
                    backgroundSize: "200% 100%",
                    animation: "kc-shimmer-text 4s linear infinite",
                  }}
                >
                  Score IA · {kill.highlight_score.toFixed(1)}/10
                </span>
              </div>
            )}
          </div>

          {/* ─── Cinematic clip frame ───────────────────────────────── */}
          <div className="mt-10 md:mt-12 relative mx-auto max-w-4xl">
            {/* Letterbox frame with double border */}
            <div
              className="relative rounded-2xl overflow-hidden bg-black"
              style={{
                boxShadow:
                  "0 0 0 1px rgba(200,170,110,0.4), 0 24px 80px rgba(0,0,0,0.6), 0 0 60px rgba(200,170,110,0.08)",
              }}
            >
              <video
                ref={videoRef}
                className="aspect-video w-full"
                src={clipSrc}
                poster={kill.thumbnail_url ?? undefined}
                playsInline
                preload="metadata"
                onClick={togglePlay}
              />

              {/* Custom play overlay — only shown when paused */}
              {!isPlaying && (
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label="Lecture"
                  className="absolute inset-0 grid place-items-center group"
                >
                  <span
                    className="grid place-items-center h-20 w-20 rounded-full border-2 border-[var(--gold)]/60 bg-black/50 backdrop-blur-sm
                               transition-all duration-300 group-hover:scale-110 group-hover:border-[var(--gold)] group-hover:bg-black/30"
                    style={{ boxShadow: "0 0 30px rgba(200,170,110,0.4)" }}
                  >
                    <svg className="h-7 w-7 text-[var(--gold)] ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </button>
              )}

              {/* Custom thin scrubber */}
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                <div
                  className="h-full bg-gradient-to-r from-[var(--gold-dark)] via-[var(--gold)] to-[var(--gold-bright)] transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>

              {/* Top-left context badges */}
              <div className="absolute top-4 left-4 flex items-center gap-2">
                <span className="font-data text-[10px] uppercase tracking-widest text-white/60 bg-black/60 backdrop-blur px-2.5 py-1 rounded">
                  {stage} · G{gameNumber}
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── DESCRIPTION + TAGS ───────────────────────────────────────── */}
      {(kill.ai_description || (kill.ai_tags && kill.ai_tags.length > 0)) && (
        <section className="relative max-w-4xl mx-auto px-6 py-12">
          {kill.ai_description && (
            <blockquote className="relative">
              {/* Big decorative quote mark */}
              <span
                className="absolute -top-6 -left-2 font-display text-7xl md:text-8xl leading-none text-[var(--gold)]/20 select-none pointer-events-none"
              >
                &ldquo;
              </span>
              <p className="relative font-display text-xl md:text-3xl font-medium text-white/95 leading-snug italic px-4">
                {kill.ai_description}
              </p>
              <span
                className="absolute -bottom-12 right-0 font-display text-7xl md:text-8xl leading-none text-[var(--gold)]/20 select-none pointer-events-none"
              >
                &rdquo;
              </span>
            </blockquote>
          )}

          {kill.ai_tags && kill.ai_tags.length > 0 && (
            <div className="mt-10 flex flex-wrap gap-2 justify-center">
              {kill.ai_tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[var(--gold)]/30 bg-gradient-to-b from-[var(--gold)]/10 to-transparent px-3.5 py-1
                             text-[11px] font-data font-bold uppercase tracking-widest text-[var(--gold)]"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ─── STATS STRIP ──────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kill.highlight_score != null && (
            <StatTile label="Score IA" value={kill.highlight_score.toFixed(1)} suffix="/10" accent="gold" />
          )}
          {kill.avg_rating != null && (kill.rating_count ?? 0) > 0 && (
            <StatTile
              label={`${kill.rating_count} votes`}
              value={kill.avg_rating.toFixed(1)}
              suffix="/5"
              accent="cyan"
            />
          )}
          {kill.impression_count != null && (kill.impression_count > 0) && (
            <StatTile
              label="Vues"
              value={formatCount(kill.impression_count)}
              accent="white"
            />
          )}
          {kill.comment_count != null && kill.comment_count > 0 && (
            <StatTile
              label="Commentaires"
              value={String(kill.comment_count)}
              accent="white"
            />
          )}
        </div>
      </section>

      {/* ─── MATCH CONTEXT ────────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 py-8">
        {matchExternalId ? (
          <Link
            href={`/match/${matchExternalId}`}
            className="group block rounded-2xl border border-[var(--border-gold)] bg-gradient-to-br from-[var(--bg-surface)] to-[var(--bg-elevated)]
                       p-5 transition-all duration-300 hover:border-[var(--gold)]/60 hover:from-[var(--bg-elevated)] hover:to-[var(--bg-surface)]"
          >
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--cyan)]/70 mb-2">
                  ▽ Match complet
                </p>
                <h2 className="font-display text-xl md:text-2xl font-black text-white">
                  KC <span className="text-[var(--text-muted)]">vs</span> {opponent.name}
                </h2>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {stage} · Game {gameNumber}
                  {matchScheduled && (
                    <>
                      {" "}·{" "}
                      {new Date(matchScheduled).toLocaleDateString("fr-FR", {
                        day: "numeric", month: "long", year: "numeric",
                      })}
                    </>
                  )}
                </p>
              </div>
              <svg
                className="h-7 w-7 text-[var(--gold)] opacity-50 group-hover:opacity-100 group-hover:translate-x-1 transition-all"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </Link>
        ) : null}
      </section>

      {/* ─── INTERACTIONS slot (rate / comment / share / inline auth) ── */}
      <section className="max-w-3xl mx-auto px-6 py-8">
        {children}
      </section>

      {/* ─── RELATED KILLS CAROUSEL ───────────────────────────────────── */}
      {relatedKills.length > 0 && (
        <section className="max-w-6xl mx-auto px-6 py-14">
          <header className="flex items-end justify-between mb-6">
            <div>
              <p className="font-data text-[10px] uppercase tracking-[0.3em] text-[var(--gold)]/70 mb-2">
                ▽ Du même match
              </p>
              <h2 className="font-display text-2xl md:text-3xl font-black text-white">
                Autres moments
              </h2>
            </div>
            {matchExternalId && (
              <Link
                href={`/match/${matchExternalId}`}
                className="text-[11px] uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--gold)] transition"
              >
                Voir le match →
              </Link>
            )}
          </header>
          <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-4 scrollbar-thin scrollbar-thumb-[var(--gold)]/30">
            {relatedKills.map((rk) => (
              <Link
                key={rk.id}
                href={`/kill/${rk.id}`}
                className="snap-start shrink-0 w-56 rounded-xl overflow-hidden border border-[var(--border-gold)]
                           bg-[var(--bg-surface)] hover:border-[var(--gold)]/60 transition-all group"
              >
                <div className="relative aspect-video w-full bg-black overflow-hidden">
                  {rk.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={rk.thumbnail_url}
                      alt=""
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid place-items-center h-full text-[var(--text-muted)] text-xs">no clip</div>
                  )}
                  {rk.highlight_score != null && (
                    <span className="absolute top-2 right-2 rounded bg-black/60 backdrop-blur px-1.5 py-0.5 font-data text-[10px] font-bold text-[var(--gold)]">
                      {rk.highlight_score.toFixed(1)}
                    </span>
                  )}
                  {(rk.multi_kill || rk.is_first_blood) && (
                    <span className="absolute top-2 left-2 rounded bg-[var(--gold)]/20 border border-[var(--gold)]/40 backdrop-blur px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-[var(--gold)]">
                      {rk.multi_kill || "First"}
                    </span>
                  )}
                </div>
                <div className="px-3 py-2.5">
                  <p className="text-xs font-medium text-white truncate">
                    {rk.killer_champion} → {rk.victim_champion}
                  </p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* PR17 — AI-similarity carousel slot. Rendered by the parent page
          (server component). Returns null when no similar clips found
          (e.g. embedding not yet generated). */}
      {similarSlot}

      {/* Riot disclaimer */}
      <p className="text-center text-[10px] text-[var(--text-disabled)] py-8 px-6">
        KCKILLS was created under Riot Games&apos; &quot;Legal Jibber Jabber&quot; policy.
        Riot Games does not endorse or sponsor this project.
      </p>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent: "gold" | "cyan" | "white";
}) {
  const colorMap = {
    gold: "text-[var(--gold)]",
    cyan: "text-[var(--cyan)]",
    white: "text-white",
  };
  return (
    <div className="rounded-xl border border-[var(--border-gold)] bg-[var(--bg-surface)] px-4 py-4 text-center">
      <p className={`font-data text-2xl font-black ${colorMap[accent]}`}>
        {value}
        {suffix && <span className="text-sm text-[var(--text-muted)] ml-1">{suffix}</span>}
      </p>
      <p className="mt-1 text-[10px] uppercase tracking-widest text-[var(--text-muted)]">
        {label}
      </p>
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
