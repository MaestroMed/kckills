"use client";

import { useRef, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { championIconUrl, championSplashUrl } from "@/lib/constants";
import { useToast } from "@/components/Toast";
import { CommentPanel } from "@/components/CommentPanel";
import { useScrollAutoplay } from "./useScrollAutoplay";
import { ScrollChipBar, type ChipFilters } from "./ScrollChipBar";
import { BgmPlayer } from "./BgmPlayer";
import { isDescriptionClean } from "@/lib/scroll/sanitize-description";

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
  killerPlayerId: string | null;
  killerChampion: string;
  victimChampion: string;
  /** Player IGNs resolved server-side from kc_matches.json + roster
   *  for the active match. Null when not resolvable (data legacy /
   *  opponent player not in our roster mapping). When KC is the killer,
   *  killerName is one of {Canna, Yike, Kyeahoo, Caliste, Busio}. */
  killerName: string | null;
  victimName: string | null;
  /** Grid pivot dimensions — enables the /scroll?axis=...&value=... filter. */
  minuteBucket: string | null;
  fightType: string | null;
  clipVertical: string;
  clipVerticalLow: string | null;
  clipHorizontal: string | null;
  /** HLS master playlist URL — null = not yet HLS-packaged. */
  hlsMasterUrl?: string | null;
  /** Versioned kill_assets manifest (migration 026). When present, the
   *  player pool prefers it over the legacy clip* fields. NULL on rows
   *  clipped before the migration ran. */
  assetsManifest?: import("./v2/FeedPlayerPool").PoolAssetsManifest | null;
  thumbnail: string | null;
  highlightScore: number | null;
  avgRating: number | null;
  ratingCount: number;
  /** Legacy single-language field — keep populated for back-compat with
   *  any code path that hasn't migrated to the multi-lang variants. */
  aiDescription: string | null;
  /** PR14 multi-language descriptions, picked by <Description> via the
   *  active LangProvider (cookie + Accept-Language fallback). When NULL
   *  the picker falls back to aiDescription_fr → aiDescription. */
  aiDescriptionFr: string | null;
  aiDescriptionEn: string | null;
  aiDescriptionKo: string | null;
  aiDescriptionEs: string | null;
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
  matchScore: string | null;
}

export interface MomentFeedItem {
  kind: "moment";
  id: string;
  score: number;
  classification: string; // solo_kill, skirmish, teamfight, ace, objective_fight
  killCount: number;
  blueKills: number;
  redKills: number;
  kcInvolvement: string; // kc_aggressor, kc_victim, kc_both
  goldSwing: number;
  clipVertical: string;
  clipVerticalLow: string | null;
  clipHorizontal: string | null;
  /** HLS master playlist URL (Phase 4). */
  hlsMasterUrl?: string | null;
  /** Versioned moments_assets manifest (future migration). NULL today
   *  on every moment — kept for type symmetry with VideoFeedItem so
   *  ScrollFeedV2 can build PoolItem from either branch. */
  assetsManifest?: import("./v2/FeedPlayerPool").PoolAssetsManifest | null;
  thumbnail: string | null;
  momentScore: number | null;
  avgRating: number | null;
  ratingCount: number;
  aiDescription: string | null;
  // Multi-lang variants — moments are NOT translated by the worker yet
  // (they aggregate kill descriptions). Kept for type symmetry with
  // VideoFeedItem so <Description> works on either branch.
  aiDescriptionFr: string | null;
  aiDescriptionEn: string | null;
  aiDescriptionKo: string | null;
  aiDescriptionEs: string | null;
  aiTags: string[];
  startTimeSeconds: number;
  endTimeSeconds: number;
}

export type FeedItem = AggregateFeedItem | VideoFeedItem | MomentFeedItem;

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

// ─── Shared props for video-bearing items ─────────────────────────────
interface SharedScrollProps {
  muted: boolean;
  onToggleMute: () => void;
  useLowQuality: boolean;
  /** Viewport width ≥ 768px. Hoisted to the parent so every scroll item
   *  doesn't register its own resize listener. */
  isDesktop: boolean;
  /** True when the user opted into `prefers-reduced-motion`. Items skip
   *  haptics and heavy flash animations. */
  reducedMotion: boolean;
  currentIndexRef: React.MutableRefObject<number>;
  /** Kill ID that triggered the grid → scroll zoom-in. Used to set the
   *  `view-transition-name` on the matching scroll item so the browser
   *  morphs the GridCell thumbnail into the full-screen video. */
  shellViewTransitionId?: string;
  /** Called by a video item when its <video> errors out (e.g. R2 404, decode
   *  failure). The feed removes the item so the dead clip never blocks the
   *  scroll, and best-effort reports it to the server for cleanup. */
  onBroken: (kind: "video" | "moment", id: string, src: string) => void;
}

export function ScrollFeed({
  items,
  videoCount = 0,
  initialKillId,
  chipFilters,
  rosterChips,
}: {
  items: FeedItem[];
  videoCount?: number;
  /** When set, the feed scrolls that item into view on mount. Enables the
   *  grid → scroll zoom-in flow without shared-layout animations. */
  initialKillId?: string;
  /** Active chip filters from the URL — drives the visual state of the
   *  filter chips at the top of the feed. */
  chipFilters?: ChipFilters;
  /** KC roster IGN/UUID/role triples for the player chip group. */
  rosterChips?: { id: string; ign: string; role: "TOP" | "JGL" | "MID" | "ADC" | "SUP" }[];
}) {
  // ─── Grid → scroll zoom-in: jump to the tapped kill on mount ───────
  const containerRefSelf = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!initialKillId) return;
    // Let the snap container settle, then align the matching item.
    const timer = window.setTimeout(() => {
      const target = containerRefSelf.current?.querySelector<HTMLElement>(
        `[data-kill-id="${CSS.escape(initialKillId)}"]`,
      );
      if (target) target.scrollIntoView({ behavior: "auto", block: "start" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialKillId]);

  // ─── F1: Global mute state (gesture-gated unmute) ──────────────────
  const [globalMuted, setGlobalMuted] = useState(true);
  const hasInteractedRef = useRef(false);

  useEffect(() => {
    // Restore user preference
    const saved = localStorage.getItem("kc-scroll-muted");
    if (saved === "false") setGlobalMuted(false);
  }, []);

  const handleFirstInteraction = () => {
    if (hasInteractedRef.current) return;
    hasInteractedRef.current = true;
    // If user hasn't explicitly chosen mute, unmute on first gesture
    const explicit = localStorage.getItem("kc-scroll-muted");
    if (explicit !== "true") {
      setGlobalMuted(false);
      localStorage.setItem("kc-scroll-muted", "false");
    }
  };

  const toggleMute = () => {
    setGlobalMuted((m) => {
      const next = !m;
      localStorage.setItem("kc-scroll-muted", String(next));
      return next;
    });
  };

  // ─── F10: Adaptive quality ─────────────────────────────────────────
  const [useLowQuality, setUseLowQuality] = useState(false);
  useEffect(() => {
    const conn = (navigator as any).connection;
    if (!conn) return;
    const check = () => {
      const slow = conn.effectiveType === "2g" || conn.effectiveType === "slow-2g" || conn.effectiveType === "3g";
      setUseLowQuality(slow);
    };
    check();
    conn.addEventListener("change", check);
    return () => conn.removeEventListener("change", check);
  }, []);

  // ─── Viewport width (hoisted from per-item resize listeners) ───────
  // Previously every scroll item registered its own resize listener. With
  // hundreds of items that's hundreds of wake-ups per resize. One listener
  // at the parent + shared boolean is plenty.
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ─── Reduced-motion preference ─────────────────────────────────────
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // ─── F2: Track current visible index for preload window ────────────
  const currentIndexRef = useRef(0);

  // ─── Broken-clip auto-skip ─────────────────────────────────────────
  // Any item whose <video> fires `error` (R2 404, decode failure, network
  // abort) is dropped from the feed in real time AND reported to the
  // server so we can purge the row from Supabase later.
  const [brokenIds, setBrokenIds] = useState<Set<string>>(() => new Set());
  const reportedRef = useRef<Set<string>>(new Set());
  const handleBroken = (kind: "video" | "moment", id: string, src: string) => {
    setBrokenIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
    if (reportedRef.current.has(id)) return;
    reportedRef.current.add(id);
    // Best-effort beacon. Never await — a broken clip must NEVER block UX.
    try {
      const payload = JSON.stringify({ kind, id, src });
      if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
        const blob = new Blob([payload], { type: "application/json" });
        navigator.sendBeacon("/api/scroll/report-broken", blob);
      } else {
        fetch("/api/scroll/report-broken", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      }
    } catch {
      // Telemetry is fire-and-forget. Swallow.
    }
  };

  // Shared props for all video items
  const shared: SharedScrollProps = {
    muted: globalMuted,
    onToggleMute: toggleMute,
    useLowQuality,
    isDesktop,
    reducedMotion,
    currentIndexRef,
    shellViewTransitionId: initialKillId,
    onBroken: handleBroken,
  };

  const visibleItems = brokenIds.size === 0
    ? items
    : items.filter((it) => !brokenIds.has(it.id));

  // ─── Swipe hint for first-time visitors ────────────────────────────
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
    <div
      ref={containerRefSelf}
      className="scroll-container fixed inset-0 z-[60] bg-black"
      onPointerDown={handleFirstInteraction}
    >
      <BgmPlayer />
      {/* Top bar — minimal, safe-area aware */}
      <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3" style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}>
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

      {/* Filter chip bar — sticky just below the top bar. URL state owned. */}
      {chipFilters && (
        <ScrollChipBar filters={chipFilters} rosterChips={rosterChips} />
      )}

      {visibleItems.map((item, i) =>
        item.kind === "moment" ? (
          <MomentScrollItem key={`m-${item.id}`} item={item} index={i} total={visibleItems.length} shared={shared} />
        ) : item.kind === "video" ? (
          <VideoScrollItem key={`v-${item.id}`} item={item} index={i} total={visibleItems.length} shared={shared} />
        ) : (
          <AggregateScrollItem key={`a-${item.id}-${i}`} item={item} index={i} total={visibleItems.length} />
        )
      )}

      {/* Swipe hint for first-time visitors */}
      {showSwipeHint && visibleItems.length > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[65] pointer-events-none animate-[fadeIn_0.5s_ease-out]">
          <div className="flex flex-col items-center gap-2 text-white/60">
            <svg className="h-6 w-6 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
            <span className="text-xs font-data uppercase tracking-widest">Swipe up</span>
          </div>
        </div>
      )}

      {visibleItems.length === 0 && <ScrollEmptyState chipFilters={chipFilters} />}
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────

function ScrollEmptyState({ chipFilters }: { chipFilters?: ChipFilters }) {
  // Detect whether the user actively narrowed the feed (vs landed on an
  // empty catalogue). Filter-driven empty state needs different copy and
  // a different CTA — telling someone "the worker is still processing"
  // when they just filtered to "Caliste pentas + KC death side" is wrong.
  const hasFilter =
    chipFilters &&
    (chipFilters.multiKillsOnly ||
      chipFilters.firstBloodsOnly ||
      chipFilters.player !== null ||
      chipFilters.fight !== null ||
      chipFilters.side !== null);

  if (hasFilter) {
    return (
      <div className="scroll-item flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="text-6xl mb-6 opacity-60">{"\uD83D\uDD0E"}</div>
          <h1 className="font-display text-3xl font-black text-[var(--gold)] mb-3 uppercase">
            Aucun clip pour ces filtres
          </h1>
          <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-6">
            Essaie de retirer un ou deux chips, ou jette un œil aux pages
            d&apos;exploration ci-dessous.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/scroll"
              className="rounded-xl bg-[var(--gold)] px-5 py-2.5 font-display text-xs font-bold uppercase tracking-widest text-[var(--bg-primary)]"
            >
              Reset filtres
            </Link>
            <Link
              href="/multikills"
              className="rounded-xl border border-[var(--orange)]/45 bg-[var(--orange)]/10 px-4 py-2.5 font-display text-xs font-bold uppercase tracking-widest text-[var(--orange)]"
            >
              Multi-kills
            </Link>
            <Link
              href="/first-bloods"
              className="rounded-xl border border-[var(--red)]/45 bg-[var(--red)]/10 px-4 py-2.5 font-display text-xs font-bold uppercase tracking-widest text-[var(--red)]"
            >
              First Bloods
            </Link>
            <Link
              href="/best"
              className="rounded-xl border border-white/15 bg-black/30 px-4 py-2.5 font-display text-xs font-bold uppercase tracking-widest text-white/80"
            >
              Meilleurs
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Catalogue is genuinely empty (worker hasn't published anything yet).
  return (
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
  );
}

// ─── Moment scroll item (grouped kills — one clip per fight) ──────────

const CLASSIFICATION_LABELS: Record<string, { label: string; color: string }> = {
  solo_kill: { label: "SOLO KILL", color: "text-[var(--gold)]" },
  skirmish: { label: "SKIRMISH", color: "text-[var(--cyan)]" },
  teamfight: { label: "TEAMFIGHT", color: "text-[var(--orange)]" },
  ace: { label: "ACE", color: "text-[var(--red)]" },
  objective_fight: { label: "OBJECTIF", color: "text-purple-400" },
};

function MomentScrollItem({ item, index, total, shared }: { item: MomentFeedItem; index: number; total: number; shared: SharedScrollProps }) {
  const [rating, setRating] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const [tapFlash, setTapFlash] = useState<null | "play" | "pause">(null);
  const rafRef = useRef<number | null>(null);
  const prevTimeRef = useRef(0);

  // Robust autoplay (see useScrollAutoplay.ts).
  const { containerRef, videoRef, visible, needsTapToPlay, manualPlay } =
    useScrollAutoplay({
      index,
      currentIndexRef: shared.currentIndexRef,
      itemId: item.id,
      onActivated: () => {
        if (!shared.reducedMotion && "vibrate" in navigator) navigator.vibrate(10);
      },
    });
  const lastTap = useRef(0);
  const singleTapTimer = useRef<number | null>(null);

  // F1: Sync mute from shared state
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = shared.muted;
    // videoRef is a stable ref
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared.muted]);

  // Progress bar via rAF — writes `--p` directly on the container element.
  // No React re-renders per tick. Only runs while the item is visible.
  useEffect(() => {
    if (!visible) return;
    const v = videoRef.current;
    const el = containerRef.current;
    if (!v || !el) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (v.duration > 0) {
        el.style.setProperty("--p", String(v.currentTime / v.duration));
      }
      if (v.currentTime < prevTimeRef.current - 1) {
        setShowReplay(true);
        window.setTimeout(() => setShowReplay(false), 1200);
      }
      prevTimeRef.current = v.currentTime;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [visible]);

  // Apple-style single-tap = play/pause with flash glyph, double-tap = rate 5.
  // The single-tap action is deferred 260ms so a second tap within that
  // window cancels it and promotes to the double-tap path.
  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    // Bail if the user tapped any interactive child (buttons, links, inputs).
    // Without this the RightSidebar's Rate / Chat / Share buttons would each
    // also flip play-pause since the click bubbles up to the container.
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, [role='button']")) return;

    const now = Date.now();
    const isDouble = now - lastTap.current < 260;
    lastTap.current = now;
    if (isDouble) {
      if (singleTapTimer.current != null) {
        window.clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      setRating(5);
      setShowDoubleTapHeart(true);
      if (!shared.reducedMotion && "vibrate" in navigator) navigator.vibrate(30);
      window.setTimeout(() => setShowDoubleTapHeart(false), 800);
      return;
    }
    if (singleTapTimer.current != null) window.clearTimeout(singleTapTimer.current);
    singleTapTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      singleTapTimer.current = null;
      if (!v) return;
      if (v.paused) {
        v.play().catch(() => {});
        setTapFlash("play");
      } else {
        v.pause();
        setTapFlash("pause");
      }
      window.setTimeout(() => setTapFlash(null), 600);
    }, 260);
  };

  const isKcAggressor = item.kcInvolvement === "kc_aggressor" || item.kcInvolvement === "kc_both";
  const cls = CLASSIFICATION_LABELS[item.classification] ?? CLASSIFICATION_LABELS.solo_kill;
  const duration = item.endTimeSeconds - item.startTimeSeconds;

  const isShellTarget = shared.shellViewTransitionId === item.id;
  return (
    <div
      ref={containerRef}
      data-kill-id={item.id}
      className="scroll-item bg-black"
      onClick={handleTap}
      style={
        isShellTarget
          ? ({ viewTransitionName: `kill-${item.id}` } as React.CSSProperties)
          : undefined
      }
    >
      {/* Double-tap rating star burst */}
      {showDoubleTapHeart && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <svg className="h-24 w-24 text-[var(--gold)]" style={{ animation: "starBurst 0.8s ease-out forwards" }} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
        </div>
      )}

      {/* Tap-to-pause flash glyph — iOS Photos vibe. Play and pause share
          the same ring + blur so the transition reads as one affordance. */}
      {tapFlash && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="scroll-tap-flash flex h-20 w-20 items-center justify-center rounded-full bg-black/45 backdrop-blur-md border border-white/20">
            {tapFlash === "play" ? (
              <svg className="h-8 w-8 text-white translate-x-[2px]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Loop-replay indicator */}
      {showReplay && (
        <div className="absolute top-20 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm pointer-events-none" style={{ animation: "replayFade 1.2s ease-out forwards" }}>
          <svg className="h-4 w-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
      )}

      {/* Adaptive quality video */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={shared.isDesktop && item.clipHorizontal
          ? item.clipHorizontal
          : (shared.useLowQuality && item.clipVerticalLow)
            ? item.clipVerticalLow
            : item.clipVertical}
        poster={item.thumbnail ?? undefined}
        muted loop playsInline
        preload={index < 2 ? "auto" : index < 4 ? "metadata" : "none"}
        onError={(e) => {
          const v = e.currentTarget;
          shared.onBroken("moment", item.id, v.currentSrc || v.src);
        }}
      />

      {/* Autoplay-blocked CTA — see VideoScrollItem for rationale. */}
      {needsTapToPlay && visible && (
        <button
          onClick={(e) => { e.stopPropagation(); manualPlay(); }}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 backdrop-blur-[2px] cursor-pointer group"
          aria-label="Lancer le clip"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--gold)]/95 shadow-[0_0_40px_rgba(200,170,110,0.6)] transition-transform group-hover:scale-110 group-active:scale-95">
            <svg className="h-9 w-9 translate-x-1 text-[var(--bg-primary)]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}

      {/* Unified bottom + top gradient overlay (single paint layer). */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background:
          "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 55%)," +
          "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 18%)",
      }} />

      {/* Progress bar — driven by --p via CSS, zero JS per frame. */}
      <div className="scroll-progress-bar" />

      <div className="relative z-10 flex h-full flex-col justify-end px-4 md:px-6 pt-20" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))" }}>
        <Link
          href={`/moment/${item.id}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-28 left-4 z-20 rounded-full bg-black/40 backdrop-blur-sm px-3 py-1 text-[10px] font-data text-[var(--text-muted)] hover:bg-black/60 transition-colors"
        >
          #{index + 1} / {total}
        </Link>

        {/* Mute toggle (shared state) */}
        <button
          onClick={(e) => { e.stopPropagation(); shared.onToggleMute(); }}
          className="absolute top-28 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm border border-white/10 hover:bg-black/60 transition-colors"
          aria-label={shared.muted ? "Activer le son" : "Couper le son"}
        >
          {shared.muted ? (
            <svg className="h-4 w-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
          ) : (
            <svg className="h-4 w-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
          )}
        </button>

        {/* Bottom overlay fades in via the `.is-visible` class that the
            IntersectionObserver toggles on the container — pure CSS, no
            layout thrash and no per-item transition state. */}
        <div className="scroll-overlay-in space-y-3">
          {/* Classification badge + kill count */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge-glass rounded-md px-3 py-1.5 text-xs font-black uppercase tracking-[0.15em] ${cls.color}`}>
              {cls.label}
            </span>
            <span className="badge-glass rounded-md px-2.5 py-1 text-[10px] font-black text-white uppercase tracking-wider">
              {item.killCount} kill{item.killCount > 1 ? "s" : ""}
            </span>
            {isKcAggressor && (
              <span className="badge-glass rounded-md px-2.5 py-1 text-[10px] font-black text-[var(--gold)] uppercase tracking-[0.15em]">
                KC WIN
              </span>
            )}
            {item.goldSwing !== 0 && Math.abs(item.goldSwing) > 1000 && (
              <span className={`rounded-md bg-white/5 border border-white/10 px-2 py-1 text-[10px] font-data font-bold ${item.goldSwing > 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
                {item.goldSwing > 0 ? "+" : ""}{(item.goldSwing / 1000).toFixed(1)}k gold
              </span>
            )}
            {item.momentScore != null && (
              <span className="rounded-md bg-[var(--gold)]/10 border border-[var(--gold)]/20 px-2 py-1 text-[10px] font-data font-bold text-[var(--gold)]">
                {item.momentScore.toFixed(1)}/10
              </span>
            )}
          </div>

          {/* Tags */}
          {item.aiTags && item.aiTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {item.aiTags.slice(0, 4).map((tag) => (
                <span key={tag} className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[9px] text-white/60">
                  #{tag}
                </span>
              ))}
            </div>
          )}

          {/* AI description */}
          {isDescriptionClean(item.aiDescription) && (
            <p className="text-[13px] leading-snug text-white/90 italic">
              &laquo; {item.aiDescription} &raquo;
            </p>
          )}

          {/* Duration + game time */}
          <p className="text-xs text-[var(--text-muted)]">
            {duration > 0 && <span className="font-data">{duration}s fight</span>}
            {" "}&middot;{" "}
            <span className="font-data text-[var(--text-secondary)]">
              T+{formatGameTime(item.startTimeSeconds)}
            </span>
          </p>
        </div>
      </div>

      <RightSidebar
        killId={item.id}
        onRateClick={() => setShowRating((s) => !s)}
        onChatClick={() => setShowComments(true)}
        rating={rating}
        shareTitle={`${cls.label} - ${item.killCount} kills`}
        shareText={item.aiDescription ?? undefined}
        visible={visible}
      />

      {showRating && <RatingSheet rating={rating} setRating={setRating} close={() => setShowRating(false)} />}
      {showComments && <CommentPanel killId={item.id} isOpen={showComments} onClose={() => setShowComments(false)} />}
    </div>
  );
}


// ─── Video scroll item (real MP4 from R2) ──────────────────────────────

function VideoScrollItem({ item, index, total, shared }: { item: VideoFeedItem; index: number; total: number; shared: SharedScrollProps }) {
  const [rating, setRating] = useState(0);
  const [showRating, setShowRating] = useState(false);
  const [showDoubleTapHeart, setShowDoubleTapHeart] = useState(false);
  const [tapFlash, setTapFlash] = useState<null | "play" | "pause">(null);
  const [showComments, setShowComments] = useState(false);
  const [showReplay, setShowReplay] = useState(false);
  const rafRef = useRef<number | null>(null);
  const prevTimeRef = useRef(0);
  const toast = useToast();
  const lastTap = useRef(0);
  const singleTapTimer = useRef<number | null>(null);

  // Robust autoplay — owns the IntersectionObserver, retries on canplay,
  // surfaces a tap-to-play affordance when autoplay is blocked. See
  // useScrollAutoplay.ts for the rationale (fixes "first clip frozen" bug).
  const { containerRef, videoRef, visible, needsTapToPlay, manualPlay } =
    useScrollAutoplay({
      index,
      currentIndexRef: shared.currentIndexRef,
      itemId: item.id,
      onActivated: () => {
        if (!shared.reducedMotion && "vibrate" in navigator) navigator.vibrate(10);
      },
    });

  // Sync mute from shared state
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.muted = shared.muted;
    // videoRef is a stable ref, no need in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared.muted]);

  // Progress bar via rAF — direct DOM write, no React re-renders.
  useEffect(() => {
    if (!visible) return;
    const v = videoRef.current;
    const el = containerRef.current;
    if (!v || !el) return;
    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      if (v.duration > 0) {
        el.style.setProperty("--p", String(v.currentTime / v.duration));
      }
      if (v.currentTime < prevTimeRef.current - 1) {
        setShowReplay(true);
        window.setTimeout(() => setShowReplay(false), 1200);
      }
      prevTimeRef.current = v.currentTime;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [visible]);

  // Single-tap = play/pause, double-tap = rate 5.
  const handleTap = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a, input, textarea, [role='button']")) return;

    const now = Date.now();
    const isDouble = now - lastTap.current < 260;
    lastTap.current = now;
    if (isDouble) {
      if (singleTapTimer.current != null) {
        window.clearTimeout(singleTapTimer.current);
        singleTapTimer.current = null;
      }
      setRating(5);
      setShowDoubleTapHeart(true);
      if (!shared.reducedMotion && "vibrate" in navigator) navigator.vibrate(30);
      toast("\u2B50 5/5 !", "success");
      window.setTimeout(() => setShowDoubleTapHeart(false), 800);
      return;
    }
    if (singleTapTimer.current != null) window.clearTimeout(singleTapTimer.current);
    singleTapTimer.current = window.setTimeout(() => {
      const v = videoRef.current;
      singleTapTimer.current = null;
      if (!v) return;
      if (v.paused) {
        v.play().catch(() => {});
        setTapFlash("play");
      } else {
        v.pause();
        setTapFlash("pause");
      }
      window.setTimeout(() => setTapFlash(null), 600);
    }, 260);
  };

  const isKcKill = item.kcInvolvement === "team_killer";
  const opponentLabel = item.opponentCode || "LEC";
  const matchDate = new Date(item.matchDate);
  const isShellTarget = shared.shellViewTransitionId === item.id;

  return (
    <div
      ref={containerRef}
      data-kill-id={item.id}
      className="scroll-item bg-black"
      onClick={handleTap}
      style={
        isShellTarget
          ? ({ viewTransitionName: `kill-${item.id}` } as React.CSSProperties)
          : undefined
      }
    >
      {/* Double-tap rating star burst */}
      {showDoubleTapHeart && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <svg className="h-24 w-24 text-[var(--gold)]" style={{ animation: "starBurst 0.8s ease-out forwards" }} fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          {!shared.reducedMotion && [...Array(8)].map((_, i) => {
            const angle = (i / 8) * Math.PI * 2;
            const px = Math.cos(angle) * 80;
            const py = Math.sin(angle) * 80;
            return (
              <div key={i} className="absolute h-2 w-2 rounded-full bg-[var(--gold)]" style={{
                animation: `particle 0.6s ease-out ${i * 0.04}s forwards`,
                "--px": `${px}px`, "--py": `${py}px`,
              } as React.CSSProperties} />
            );
          })}
        </div>
      )}

      {/* Tap-to-pause flash glyph */}
      {tapFlash && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none">
          <div className="scroll-tap-flash flex h-20 w-20 items-center justify-center rounded-full bg-black/45 backdrop-blur-md border border-white/20">
            {tapFlash === "play" ? (
              <svg className="h-8 w-8 text-white translate-x-[2px]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            ) : (
              <svg className="h-8 w-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            )}
          </div>
        </div>
      )}

      {/* Loop-replay indicator */}
      {showReplay && (
        <div className="absolute top-20 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm pointer-events-none" style={{ animation: "replayFade 1.2s ease-out forwards" }}>
          <svg className="h-4 w-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </div>
      )}

      {/* Adaptive quality video */}
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={shared.isDesktop && item.clipHorizontal
          ? item.clipHorizontal
          : (shared.useLowQuality && item.clipVerticalLow)
            ? item.clipVerticalLow
            : item.clipVertical}
        poster={item.thumbnail ?? undefined}
        muted loop playsInline
        preload={index < 2 ? "auto" : index < 4 ? "metadata" : "none"}
        onError={(e) => {
          const v = e.currentTarget;
          shared.onBroken("video", item.id, v.currentSrc || v.src);
        }}
      />

      {/* Autoplay-blocked CTA — only renders when the browser refused
          play() AND the canplay-retry also failed. Tapping it counts as a
          user gesture so the next play() always succeeds. */}
      {needsTapToPlay && visible && (
        <button
          onClick={(e) => { e.stopPropagation(); manualPlay(); }}
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 backdrop-blur-[2px] cursor-pointer group"
          aria-label="Lancer le clip"
        >
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[var(--gold)]/95 shadow-[0_0_40px_rgba(200,170,110,0.6)] transition-transform group-hover:scale-110 group-active:scale-95">
            <svg className="h-9 w-9 translate-x-1 text-[var(--bg-primary)]" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}

      {/* Unified gradient overlay (single paint layer). */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background:
          "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 55%)," +
          "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 18%)",
      }} />

      {/* Progress bar — driven by --p via CSS. */}
      <div className="scroll-progress-bar" />

      <div className="relative z-10 flex h-full flex-col justify-end px-4 md:px-6 pt-20" style={{ paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))" }}>
        {/* Kill ID link */}
        <Link
          href={`/kill/${item.id}`}
          onClick={(e) => e.stopPropagation()}
          className="absolute top-28 left-4 z-20 rounded-full bg-black/40 backdrop-blur-sm px-3 py-1 text-[10px] font-data text-[var(--text-muted)] hover:bg-black/60 transition-colors"
        >
          #{index + 1} / {total}
        </Link>

        {/* F1: Mute toggle (shared state) */}
        <button
          onClick={(e) => { e.stopPropagation(); shared.onToggleMute(); }}
          className="absolute top-28 right-4 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 backdrop-blur-sm border border-white/10 hover:bg-black/60 transition-colors"
          aria-label={shared.muted ? "Activer le son" : "Couper le son"}
        >
          {shared.muted ? (
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

        {/* Bottom overlay — CSS-driven fade via .is-visible on container. */}
        <div className="scroll-overlay-in space-y-3">
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
          {isDescriptionClean(item.aiDescription) && (
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
                {item.matchScore && <span className="ml-1 font-data">{item.matchScore}</span>}
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

      {/* ═══ RIGHT SIDEBAR ═══ */}
      <RightSidebar
        killId={item.id}
        onRateClick={() => setShowRating((s) => !s)}
        onChatClick={() => setShowComments(true)}
        rating={rating}
        shareTitle={`${item.killerChampion} kill ${item.victimChampion}`}
        shareText={item.aiDescription ?? undefined}
        visible={visible}
      />

      {showRating && (
        <RatingSheet
          rating={rating}
          setRating={setRating}
          close={() => setShowRating(false)}
        />
      )}
      {showComments && <CommentPanel killId={item.id} isOpen={showComments} onClose={() => setShowComments(false)} />}
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
    <div ref={ref} data-kill-id={item.id} className="scroll-item bg-black" onClick={handleDoubleTap}>
      {showDoubleTapHeart && (
        <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none animate-[scaleIn_0.5s_ease-out]">
          <span className="text-8xl opacity-90 drop-shadow-2xl">&#x2B50;</span>
        </div>
      )}

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={championSplashUrl(killerChamp)}
        alt={`Splash art du champion ${killerChamp}`}
        className={`absolute inset-0 h-full w-full object-cover transition-all duration-700 ${visible ? "scale-100 opacity-40" : "scale-110 opacity-0"}`}
        loading={index < 3 ? "eager" : "lazy"}
      />

      <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-black/60 pointer-events-none" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50 pointer-events-none" />

      <div className="relative z-10 flex h-full flex-col justify-end px-5 pb-8 pt-20">
        <Link
          href={`/kill/${item.id}`}
          className="absolute top-28 left-4 z-20 rounded-full bg-black/40 backdrop-blur-sm px-3 py-1 text-[10px] font-data text-[var(--text-muted)] hover:bg-black/60 transition-colors"
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
        onChatClick={() => {}}
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
  onChatClick,
  rating,
  shareTitle,
  shareText,
  visible,
}: {
  killId: string;
  onRateClick: () => void;
  onChatClick: () => void;
  rating: number;
  shareTitle: string;
  /** Optional descriptive body sent with Web Share — used by Discord/
   *  WhatsApp/Twitter to pre-fill the message instead of just the URL.
   *  When omitted, only the URL + title are shared (legacy behaviour). */
  shareText?: string;
  visible: boolean;
}) {
  const [showShareSheet, setShowShareSheet] = useState(false);
  const toast = useToast();

  const shareUrl = typeof window !== "undefined" ? `${window.location.origin}/kill/${killId}` : "";

  const handleShare = async (e: React.MouseEvent) => {
    // Prevent the underlying tap-to-pause handler from firing.
    e.stopPropagation();
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({
          url: shareUrl,
          title: shareTitle,
          ...(shareText ? { text: shareText } : {}),
        });
        // Native sheet closed cleanly — no toast needed (the sheet IS the feedback).
      } catch (err) {
        // AbortError = user dismissed the native sheet, that's fine.
        const name = (err as { name?: string })?.name;
        if (name && name !== "AbortError") {
          // Real failure — fall back to the desktop sheet so they can copy.
          setShowShareSheet(true);
        }
      }
      return;
    }
    setShowShareSheet(true);
  };

  return (
    <>
      <div className={`absolute right-3 md:right-4 bottom-36 md:bottom-44 z-10 flex flex-col items-center gap-5 md:gap-6 transition-all duration-500 delay-200 ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"}`}>
        {/* Rate */}
        <button className="flex flex-col items-center gap-1.5" onClick={onRateClick} aria-label="Noter">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/10 transition-all hover:scale-110 hover:bg-[var(--gold)]/20 hover:border-[var(--gold)]/30 active:scale-90">
            <svg className="h-6 w-6 text-[var(--gold)]" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold text-white/70">{rating > 0 ? `${rating}/5` : "Rate"}</span>
        </button>

        {/* F5: Chat — opens CommentPanel */}
        <button className="flex flex-col items-center gap-1.5" onClick={onChatClick} aria-label="Commentaires">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/10 transition-all hover:scale-110 active:scale-90">
            <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold text-white/70">Chat</span>
        </button>

        {/* F6: Share — native on mobile, sheet on desktop */}
        <button className="flex flex-col items-center gap-1.5" onClick={handleShare} aria-label="Partager">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/10 transition-all hover:scale-110 active:scale-90">
            <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold text-white/70">Share</span>
        </button>

        {/* Detail */}
        <Link href={`/kill/${killId}`} className="flex flex-col items-center gap-1.5">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-black/50 backdrop-blur-sm border border-white/10 transition-all hover:scale-110 active:scale-90">
            <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <span className="text-[10px] font-bold text-white/70">Detail</span>
        </Link>
      </div>

      {/* F6: Desktop Share Sheet */}
      {showShareSheet && (
        <ShareSheet url={shareUrl} title={shareTitle} onClose={() => setShowShareSheet(false)} />
      )}
    </>
  );
}

function ShareSheet({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  const toast = useToast();
  const copyLink = async () => {
    await navigator.clipboard.writeText(url);
    toast("Lien copie !", "success");
    onClose();
  };
  return (
    <>
      <div className="absolute inset-0 z-30 bg-black/40" onClick={onClose} />
      <div className="comment-panel absolute bottom-0 left-0 right-0 z-40 rounded-t-2xl bg-black/90 backdrop-blur-xl border-t border-[var(--gold)]/20 px-6 py-6">
        <div className="flex justify-center pb-3">
          <div className="h-1 w-10 rounded-full bg-white/20" />
        </div>
        <h3 className="text-sm font-bold text-white mb-4 text-center">Partager</h3>
        <div className="grid grid-cols-4 gap-4">
          {/* Copy Link */}
          <button onClick={copyLink} className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 border border-white/10">
              <svg className="h-6 w-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
              </svg>
            </div>
            <span className="text-[10px] text-white/70">Copier</span>
          </button>
          {/* X/Twitter */}
          <button onClick={() => { window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`, "_blank"); onClose(); }} className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 border border-white/10">
              <svg className="h-5 w-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </div>
            <span className="text-[10px] text-white/70">X</span>
          </button>
          {/* Discord */}
          <button onClick={() => { navigator.clipboard.writeText(`${title} ${url}`); toast("Copie pour Discord !", "success"); onClose(); }} className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#5865F2]/20 border border-[#5865F2]/30">
              <svg className="h-5 w-5 text-[#5865F2]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
              </svg>
            </div>
            <span className="text-[10px] text-white/70">Discord</span>
          </button>
          {/* WhatsApp */}
          <button onClick={() => { window.open(`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`, "_blank"); onClose(); }} className="flex flex-col items-center gap-2">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#25D366]/20 border border-[#25D366]/30">
              <svg className="h-5 w-5 text-[#25D366]" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </div>
            <span className="text-[10px] text-white/70">WhatsApp</span>
          </button>
        </div>
      </div>
    </>
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
