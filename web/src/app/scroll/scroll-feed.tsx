"use client";

import { useRef, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { championIconUrl, championSplashUrl } from "@/lib/constants";
import { useToast } from "@/components/Toast";

// ─── Feed item types (discriminated union) ─────────────────────────────
//
// Two kinds of items can appear in /scroll:
//   1. `aggregate` — legacy per-player-per-game stats from kc_matches.json.
//      No real clip, splash-art background + KDA card.
//   2. `video` — a real kill published by the worker pipeline. Has a real
//      MP4 on R2, a highlight score, and a Gemini AI description.
//
// During the transition period both coexist: videos rank first, aggregates
// fill the long tail so the feed always feels full.

export interface AggregateFeedItem {
  kind: "aggregate";
  id: string;
  kcPlayer: { name: string; champion: string; role: string; kills: number; deaths: number; assists: number; gold: number; cs: number; level: number };
  oppPlayer: { name: string; champion: string; role: string; kills: number; deaths: number; assists: number; gold: number; cs: number; level: number } | null;
  match: { id: string; date: string; stage: string; opponent: { code: string; name: string }; kc_won: boolean };
  game: { number: number; kc_kills: number; opp_kills: number };
  isKcKiller: boolean;
  score: number;
  multiKill: string | null;
}

export interface VideoFeedItem {
  kind: "video";
  id: string;
  score: number;
  killerChampion: string;
  victimChampion: string;
  clipVertical: string;
  clipVerticalLow: string | null;
  clipHorizontal: string | null;
  thumbnail: string | null;
  highlightScore: number | null;
  avgRating: number | null;
  ratingCount: number;
  aiDescription: string | null;
  aiTags: string[];
  multiKill: string | null;
  isFirstBlood: boolean;
  kcInvolvement: string | null; // 'team_killer' | 'team_victim' | null
  gameTimeSeconds: number;
  gameNumber: number;
  matchExternalId: string;
  matchStage: string;
  matchDate: string;
  opponentCode: string;
  kcWon: boolean | null;
}

export type FeedItem = AggregateFeedItem | VideoFeedItem;

// ─── Helpers ───────────────────────────────────────────────────────────

function cleanName(name: string): string {
  return name.replace(/^[A-Z]+ /, "");
}

function deriveKillTags(
  player: { kills: number; deaths: number; assists: number; role: string },
  game: { kc_kills: number; opp_kills: number },
): string[] {
  const tags: string[] = [];
  const kp = game.kc_kills > 0 ? (player.kills + player.assists) / game.kc_kills : 0;
  if (player.deaths === 0 && player.kills >= 2) tags.push("clean");
  if (player.kills >= 5) tags.push("carry");
  if (player.kills >= 3 && player.deaths <= 1) tags.push("outplay");
  if (kp >= 0.7) tags.push("teamfight");
  if (player.kills >= 2 && player.deaths === 0 && player.assists >= 3) tags.push("domination");
  if (game.kc_kills > game.opp_kills * 2) tags.push("stomp");
  if (game.kc_kills < game.opp_kills && player.kills >= 3) tags.push("carry_in_loss");
  return tags.slice(0, 3);
}

function displayRole(role: string): string {
  const map: Record<string, string> = { top: "TOP", jungle: "JGL", mid: "MID", bottom: "ADC", support: "SUP" };
  return map[role] || role.toUpperCase();
}

function formatGameTime(seconds: number): string {
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
}

// ─── Top-level feed ────────────────────────────────────────────────────

export function ScrollFeed({ items, videoCount = 0 }: { items: FeedItem[]; videoCount?: number }) {
  const [showSwipeHint, setShowSwipeHint] = useState(() => {
    if (typeof window === "undefined") return false;
    return !localStorage.getItem("kc-scroll-seen");
  });

  useEffect(() => {
    if (!showSwipeHint) return;
    const timer = setTimeout(() => {
      setShowSwipeHint(false);
      localStorage.setItem("kc-scroll-seen", "1");
    }, 4000);
    const handler = () => {
      setShowSwipeHint(false);
      localStorage.setItem("kc-scroll-seen", "1");
    };
    window.addEventListener("scroll", handler, { once: true, capture: true });
    window.addEventListener("touchmove", handler, { once: true });
    return () => {
      clearTimeout(timer);
      window.removeEventListener("scroll", handler);
      window.removeEventListener("touchmove", handler);
    };
  }, [showSwipeHint]);

  return (
    <div className="scroll-container fixed inset-0 z-[60] bg-black">
      {/* Top bar */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3">
        <Link href="/" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
          <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Link>
        <div className="flex flex-col items-center">
          <span className="font-display text-sm font-bold tracking-widest text-[var(--gold)]/80">KCKILLS</span>
          <span className="font-data text-[9px] uppercase tracking-widest text-[var(--gold)]/50">
            {videoCount > 0
              ? `${videoCount} clips \u00b7 ${items.length - videoCount} stats`
              : `${items.length} kills \u00b7 splash mode`}
          </span>
        </div>
        <Link
          href="/#highlights"
          className="flex h-9 items-center gap-1 rounded-full bg-red-600/90 backdrop-blur-sm px-3 text-[10px] font-bold text-white"
          aria-label="Voir les clips YouTube sur la home"
        >
          <span>&#9654;</span>
          <span>Clips</span>
        </Link>
      </div>

      {videoCount === 0 && (
        <div className="fixed bottom-4 left-4 z-50 rounded-full bg-black/70 backdrop-blur-sm border border-[var(--gold)]/30 px-3 py-1.5 text-[10px] text-[var(--gold)]/70 uppercase tracking-widest pointer-events-none">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--gold)] animate-pulse" />
            Beta &middot; clips video en integration
          </span>
        </div>
      )}

      {items.map((item, i) =>
        item.kind === "video" ? (
          <VideoScrollItem key={`v-${item.id}`} item={item} index={i} total={items.length} />
        ) : (
          <AggregateScrollItem key={`a-${item.id}-${i}`} item={item} index={i} total={items.length} />
        )
      )}

      {/* Swipe hint for first-time visitors */}
      {showSwipeHint && items.length > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[65] pointer-events-none animate-[fadeIn_0.5s_ease-out]">
          <div className="flex flex-col items-center gap-2 text-white/60">
            <svg className="h-6 w-6 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
            <span className="text-xs font-data uppercase tracking-widest">Swipe up</span>
          </div>
        </div>
      )}

      {items.length === 0 && (
        <div className="scroll-item flex items-center justify-center">
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-6">{"\u2694\uFE0F"}</div>
            <h1 className="font-display text-3xl font-black text-[var(--gold)] mb-3 uppercase">
              Clips en cours de traitement
            </h1>
            <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-6">
              Le worker Python broie les 83 matchs KC pour en extraire les
              kills les plus hypes. En attendant, va regarder les clips YouTube
              officiels sur la home.
            </p>
            <Link
              href="/#highlights"
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--gold)] px-6 py-3 font-display text-xs font-bold uppercase tracking-widest text-[var(--bg-primary)]"
            >
              Voir les clips YouTube
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Video scroll item (real MP4 from R2) ──────────────────────────────

function VideoScrollItem({ item, index, total }: { item: VideoFeedItem; index: number; total: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [rating, setRating] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const toast = useToast();
  const lastTap = useRef(0);

  // Persist mute preference
  useEffect(() => {
    const saved = localStorage.getItem("kc-scroll-muted");
    if (saved === "false") setIsMuted(false);
  }, []);

  // Sync mute state to video element
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = isMuted;
  }, [isMuted]);

  // Desktop detection — use horizontal 16:9 clip on wide viewports
  useEffect(() => {
    const check = () => setIsDesktop(window.innerWidth >= 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setRating(5);
      setShowDoubleTapHeart(true);
      toast("\u2B50 5/5 !", "success");
      setTimeout(() => setShowDoubleTapHeart(false), 1000);
    }
    lastTap.current = now;
  };

  // IntersectionObserver → autoplay when ≥60% visible, pause otherwise
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        const isVis = entry.isIntersecting;
        setVisible(isVis);
        const v = videoRef.current;
        if (!v) return;
        if (isVis) {
          v.currentTime = 0;
          v.play().catch(() => {
            // Autoplay rejected (iOS quirks) — user will need to tap
          });
        } else {
          v.pause();
        }
      },
      { threshold: 0.6 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const isKcKill = item.kcInvolvement === "team_killer";
  const opponentLabel = item.opponentCode || "LEC";
  const matchDate = new Date(item.matchDate);

  return (
    <div ref={containerRef} className="scroll-item bg-black" onClick={handleDoubleTap}>
      {showDoubleTapHeart && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none animate-[scaleIn_0.5s_ease-out]">
          <span className="text-8xl opacity-90 drop-shadow-2xl">&#x2B50;</span>
        </div>
      )}

      {/* ═══ REAL VIDEO BACKGROUND ═══ */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={isDesktop && item.clipHorizontal ? item.clipHorizontal : item.clipVertical}
        poster={item.thumbnail ?? undefined}
        muted
        loop
        playsInline
        preload={index < 3 ? "auto" : "metadata"}
      />

      {/* Minimal gradient — only darken the bottom where text overlay sits.
          The video should fill the screen and breathe on desktop. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent pointer-events-none" />
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/50 to-transparent pointer-events-none" />

      <div className="relative z-10 flex h-full flex-col justify-end px-4 md:px-6 pt-20" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))" }}>
        {/* Kill ID link */}
        <Link
          href={`/kill/${item.id}`}
          className="absolute top-16 left-4 z-20 rounded-full bg-black/40 backdrop-blur-sm px-3 py-1 text-[10px] font-data text-[var(--text-muted)] hover:bg-black/60 transition-colors"
        >
          #{index + 1} / {total}
        </Link>

        {/* Mute/unmute toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsMuted((m) => {
              const next = !m;
              localStorage.setItem("kc-scroll-muted", String(next));
              return next;
            });
          }}
          className="absolute top-16 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm border border-white/10 hover:bg-black/60 transition-colors"
          aria-label={isMuted ? "Activer le son" : "Couper le son"}
        >
          {isMuted ? (
            <svg className="h-4 w-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
            </svg>
          ) : (
            <svg className="h-4 w-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
            </svg>
          )}
        </button>

        {/* ═══ BOTTOM INFO — compact on mobile, spacious on desktop ═══ */}
        <div className={`space-y-3 transition-all duration-500 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2">
            {isKcKill ? (
              <span className="badge-glass rounded-md px-2.5 py-1 text-[10px] font-black text-[var(--gold)] uppercase tracking-[0.15em]">
                KC Kill
              </span>
            ) : (
              <span className="badge-glass-red rounded-md px-2.5 py-1 text-[10px] font-black text-[var(--red)] uppercase tracking-[0.15em]">
                KC Death
              </span>
            )}
            {item.isFirstBlood && (
              <span className="rounded-md bg-[var(--red)]/20 border border-[var(--red)]/40 px-2.5 py-1 text-[10px] font-black text-[var(--red)] uppercase tracking-[0.15em]">
                First Blood
              </span>
            )}
            {item.multiKill && (
              <span className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                item.multiKill === "penta" ? "badge-glass-penta text-[var(--gold)]" :
                item.multiKill === "quadra" ? "badge-glass text-[var(--orange)]" :
                item.multiKill === "triple" ? "badge-glass text-[var(--orange)]" :
                "badge-glass text-[var(--text-secondary)]"
              }`}>
                {item.multiKill} kill
              </span>
            )}
            {item.highlightScore != null && (
              <span className="rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2 py-1 text-[10px] font-data font-bold text-[var(--gold)]">
                {item.highlightScore.toFixed(1)}/10
              </span>
            )}
          </div>

          {/* AI tags */}
          {item.aiTags && item.aiTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.aiTags.slice(0, 4).map((tag) => (
                <span key={tag} className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[9px] text-white/60">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* Champion matchup — responsive text sizing */}
          <div>
            <span className={`font-display text-xl md:text-2xl font-black ${isKcKill ? "text-[var(--gold)]" : "text-white"}`}>
              {item.killerChampion}
            </span>
            <span className="text-[var(--gold)] mx-1.5 md:mx-2 text-base md:text-lg">&rarr;</span>
            <span className={`font-display text-xl md:text-2xl font-black ${!isKcKill ? "text-[var(--gold)]" : "text-white/80"}`}>
              {item.victimChampion}
            </span>
          </div>

          {/* AI description — the hyped caster line */}
          {item.aiDescription && (
            <p className="text-[13px] leading-snug text-white/90 italic">
              &laquo; {item.aiDescription} &raquo;
            </p>
          )}

          {/* Match context */}
          <p className="text-xs text-[var(--text-muted)]">
            KC vs {opponentLabel}
            {item.kcWon !== null && (
              <span className={`ml-1.5 font-bold ${item.kcWon ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                {item.kcWon ? "W" : "L"}
              </span>
            )}
            {" "}&middot; {item.matchStage} &middot; Game {item.gameNumber} &middot;{" "}
            <span className="font-data text-[var(--text-secondary)]">
              T+{formatGameTime(item.gameTimeSeconds)}
            </span>
            {item.matchDate && (
              <>
                {" "}&middot;{" "}
                {matchDate.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
              </>
            )}
          </p>
        </div>
      </div>

      {/* ═══ RIGHT SIDEBAR (shared with aggregate items) ═══ */}
      <RightSidebar
        killId={item.id}
        onRateClick={() => setShowRating((s) => !s)}
        rating={rating}
        shareTitle={`${item.killerChampion} kill ${item.victimChampion}`}
        visible={visible}
      />

      {showRating && (
        <RatingSheet
          rating={rating}
          setRating={setRating}
          close={() => setShowRating(false)}
        />
      )}
    </div>
  );
}

// ─── Legacy aggregate scroll item (splash art + KDA card) ──────────────

function AggregateScrollItem({ item, index, total }: { item: AggregateFeedItem; index: number; total: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [rating, setRating] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const toast = useToast();
  const lastTap = useRef(0);

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setRating(5);
      setShowDoubleTapHeart(true);
      toast("\u2B50 5/5 !", "success");
      setTimeout(() => setShowDoubleTapHeart(false), 1000);
    }
    lastTap.current = now;
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.6 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const killer = item.isKcKiller ? item.kcPlayer : item.oppPlayer;
  const victim = item.isKcKiller ? item.oppPlayer : item.kcPlayer;
  const killerChamp = killer?.champion ?? "Aatrox";
  const date = new Date(item.match.date);

  return (
    <div ref={ref} className="scroll-item bg-black" onClick={handleDoubleTap}>
      {showDoubleTapHeart && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none animate-[scaleIn_0.5s_ease-out]">
          <span className="text-8xl opacity-90 drop-shadow-2xl">&#x2B50;</span>
        </div>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={championSplashUrl(killerChamp)}
        alt=""
        className={`absolute inset-0 h-full w-full object-cover transition-all duration-700 ${visible ? "scale-100 opacity-40" : "scale-110 opacity-0"}`}
        loading={index < 3 ? "eager" : "lazy"}
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/60 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50 pointer-events-none" />

      <div className="relative z-10 flex h-full flex-col justify-end px-5 pb-8 pt-20">
        <Link
          href={`/kill/${item.id}`}
          className="absolute top-16 left-4 z-20 rounded-full bg-black/40 backdrop-blur-sm px-3 py-1 text-[10px] font-data text-[var(--text-muted)] hover:bg-black/60 transition-colors"
        >
          #{index + 1} / {total}
        </Link>

        <div className={`mb-auto mt-auto flex items-center justify-center gap-5 transition-all duration-500 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"}`}>
          <div className="text-center">
            <div className={`overflow-hidden rounded-2xl border-2 shadow-2xl ${item.isKcKiller ? "border-[var(--gold)]/60 shadow-[var(--gold)]/20" : "border-white/20"}`}>
              <Image
                src={championIconUrl(killerChamp)}
                alt={killerChamp}
                width={80}
                height={80}
                className="object-cover"
                priority={index < 3}
              />
            </div>
            <p className={`mt-2 text-xs font-bold ${item.isKcKiller ? "text-[var(--gold)]" : "text-white"}`}>
              {cleanName(killer?.name ?? "?")}
            </p>
          </div>

          <div className="flex flex-col items-center -mt-4">
            <div className="h-12 w-12 flex items-center justify-center rounded-full bg-[var(--gold)]/20 border border-[var(--gold)]/30 backdrop-blur-sm">
              <svg className="h-5 w-5 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </div>
          </div>

          <div className="text-center">
            <div className={`overflow-hidden rounded-2xl border-2 shadow-2xl ${!item.isKcKiller ? "border-[var(--gold)]/60 shadow-[var(--gold)]/20" : "border-[var(--red)]/40"}`}>
              <Image
                src={championIconUrl(victim?.champion ?? "Aatrox")}
                alt={victim?.champion ?? "?"}
                width={80}
                height={80}
                className="object-cover"
                priority={index < 3}
              />
            </div>
            <p className={`mt-2 text-xs font-bold ${!item.isKcKiller ? "text-[var(--gold)]" : "text-white/70"}`}>
              {cleanName(victim?.name ?? "?")}
            </p>
          </div>
        </div>

        <div className={`space-y-3 transition-all duration-500 delay-100 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"}`}>
          <div className="flex items-center gap-2">
            {item.isKcKiller ? (
              <span className="badge-glass rounded-md px-2.5 py-1 text-[10px] font-black text-[var(--gold)] uppercase tracking-[0.15em]">
                KC Kill
              </span>
            ) : (
              <span className="badge-glass-red rounded-md px-2.5 py-1 text-[10px] font-black text-[var(--red)] uppercase tracking-[0.15em]">
                KC Death
              </span>
            )}
            {item.multiKill && (
              <span className={`rounded-md px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${
                item.multiKill === "penta" ? "badge-glass-penta text-[var(--gold)]" :
                item.multiKill === "quadra" ? "badge-glass text-[var(--orange)]" :
                item.multiKill === "triple" ? "badge-glass text-[var(--orange)]" :
                "badge-glass text-[var(--text-secondary)]"
              }`}>
                {item.multiKill} kill
              </span>
            )}
            {item.match.kc_won && (
              <span className="rounded-md bg-[var(--green)]/10 border border-[var(--green)]/20 px-2 py-1 text-[10px] font-bold text-[var(--green)]">W</span>
            )}
            {item.score > 15 && (
              <span className="rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2 py-1 text-[10px] font-data font-bold text-[var(--gold)]">
                {item.score.toFixed(0)}pts
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5">
            {deriveKillTags(item.kcPlayer, item.game).map((tag) => (
              <span key={tag} className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[9px] text-white/50">
                #{tag}
              </span>
            ))}
          </div>

          <div>
            <span className={`font-display text-2xl font-black ${item.isKcKiller ? "text-[var(--gold)]" : "text-white"}`}>
              {cleanName(killer?.name ?? "?")}
            </span>
            <span className="text-sm text-[var(--text-muted)] ml-2">{killerChamp}</span>
            <span className="text-[var(--gold)] mx-2 text-lg">&rarr;</span>
            <span className={`font-display text-2xl font-black ${!item.isKcKiller ? "text-[var(--gold)]" : "text-white/80"}`}>
              {cleanName(victim?.name ?? "?")}
            </span>
            <span className="text-sm text-[var(--text-muted)] ml-2">{victim?.champion}</span>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            KC vs {item.match.opponent.code} &middot; {item.match.stage} &middot; Game {item.game.number} &middot;{" "}
            <span className="font-data text-[var(--text-secondary)]">{item.game.kc_kills}-{item.game.opp_kills}</span> &middot;{" "}
            {date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })}
          </p>

          <div className="flex items-center gap-3 rounded-xl bg-black/50 backdrop-blur-md border border-white/10 px-3 py-2.5">
            <Image
              src={championIconUrl(item.kcPlayer.champion)}
              alt={item.kcPlayer.champion}
              width={36}
              height={36}
              className="rounded-full border border-[var(--gold)]/30"
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[var(--gold)]">{cleanName(item.kcPlayer.name)}</p>
              <p className="text-[10px] text-[var(--text-muted)]">{item.kcPlayer.champion} &middot; {displayRole(item.kcPlayer.role)}</p>
            </div>
            <div className="text-right">
              <p className="font-data text-base font-black">
                <span className="text-[var(--green)]">{item.kcPlayer.kills}</span>
                <span className="text-white/30">/</span>
                <span className="text-[var(--red)]">{item.kcPlayer.deaths}</span>
                <span className="text-white/30">/</span>
                <span className="text-[var(--text-secondary)]">{item.kcPlayer.assists}</span>
              </p>
              <p className="font-data text-[10px] text-[var(--text-muted)]">{(item.kcPlayer.gold / 1000).toFixed(1)}k &middot; {item.kcPlayer.cs}CS</p>
            </div>
          </div>
        </div>
      </div>

      <RightSidebar
        killId={item.id}
        onRateClick={() => setShowRating((s) => !s)}
        rating={rating}
        shareTitle={`${cleanName(killer?.name ?? "")} kills ${cleanName(victim?.name ?? "")}`}
        visible={visible}
      />

      {showRating && (
        <RatingSheet
          rating={rating}
          setRating={setRating}
          close={() => setShowRating(false)}
        />
      )}
    </div>
  );
}

// ─── Shared UI pieces ──────────────────────────────────────────────────

function RightSidebar({
  killId,
  onRateClick,
  rating,
  shareTitle,
  visible,
}: {
  killId: string;
  onRateClick: () => void;
  rating: number;
  shareTitle: string;
  visible: boolean;
}) {
  return (
    <div className={`absolute right-3 md:right-4 bottom-36 md:bottom-44 z-10 flex flex-col items-center gap-5 md:gap-6 transition-all duration-500 delay-200 ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"}`}>
      <button
        className="flex flex-col items-center gap-1.5"
        onClick={onRateClick}
        aria-label="Noter"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/10 transition-all hover:scale-110 hover:bg-[var(--gold)]/20 hover:border-[var(--gold)]/30 active:scale-90">
          <svg className="h-6 w-6 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </div>
        <span className="text-[10px] font-bold text-white/70">{rating > 0 ? `${rating}/5` : "Rate"}</span>
      </button>

      <Link href={`/kill/${killId}`} className="flex flex-col items-center gap-1.5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/10 transition-all hover:scale-110 active:scale-90">
          <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        </div>
        <span className="text-[10px] font-bold text-white/70">Chat</span>
      </Link>

      <button
        className="flex flex-col items-center gap-1.5"
        onClick={() => {
          const url = `${typeof window !== "undefined" ? window.location.origin : ""}/kill/${killId}`;
          if (typeof navigator !== "undefined" && navigator.share) {
            navigator.share({ url, title: shareTitle }).catch(() => {});
          } else {
            // Desktop fallback: open Twitter/X share intent
            window.open(
              `https://x.com/intent/tweet?text=${encodeURIComponent(shareTitle)}&url=${encodeURIComponent(url)}`,
              "_blank",
              "noopener,width=550,height=420",
            );
          }
        }}
        aria-label="Partager sur X"
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/10 transition-all hover:scale-110 active:scale-90">
          <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </div>
        <span className="text-[10px] font-bold text-white/70">X</span>
      </button>

      <Link href={`/kill/${killId}`} className="flex flex-col items-center gap-1.5">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/10 transition-all hover:scale-110 active:scale-90">
          <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <span className="text-[10px] font-bold text-white/70">Detail</span>
      </Link>
    </div>
  );
}

function RatingSheet({
  rating,
  setRating,
  close,
}: {
  rating: number;
  setRating: (v: number) => void;
  close: () => void;
}) {
  const toast = useToast();
  return (
    <div className="absolute bottom-0 left-0 right-0 z-20 rounded-t-2xl bg-black/80 backdrop-blur-xl border-t border-[var(--gold)]/20 p-6 animate-[slideUp_0.3s_ease-out]">
      <div className="flex items-center justify-between mb-4">
        <p className="font-display font-bold text-[var(--gold)]">Note ce kill</p>
        <button onClick={close} className="text-[var(--text-muted)] text-sm">Fermer</button>
      </div>
      <div className="flex justify-center gap-3">
        {[1, 2, 3, 4, 5].map((s) => (
          <button
            key={s}
            onClick={() => {
              setRating(s);
              toast(`${s}/5 enregistr\u00e9 !`);
              setTimeout(close, 400);
            }}
            className={`flex h-14 w-14 items-center justify-center rounded-xl border text-2xl transition-all active:scale-90 ${
              rating >= s
                ? "bg-[var(--gold)]/20 border-[var(--gold)]/50 scale-110"
                : "bg-white/5 border-white/10 hover:bg-white/10"
            }`}
          >
            <svg className={`h-7 w-7 ${rating >= s ? "text-[var(--gold)]" : "text-white/30"}`} fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </button>
        ))}
      </div>
      {rating > 0 && (
        <p className="text-center mt-3 text-sm text-[var(--gold)]">{rating}/5 enregistr&eacute;</p>
      )}
    </div>
  );
}
