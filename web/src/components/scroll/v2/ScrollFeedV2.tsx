"use client";

/**
 * ScrollFeedV2 — Phase 2 orchestrator (gesture-driven).
 *
 * Phase deltas vs Phase 1:
 *   • CSS scroll-snap-mandatory REPLACED by useFeedGesture (drag +
 *     wheel + keyboard with framer-motion spring snap on release)
 *   • Container is now a motion.div with style={{ y }} that follows
 *     the gesture in real time
 *   • The pool's videos are anchored to the same containerY motion
 *     value so they slide in lockstep with the drag
 *   • Items are absolutely positioned by index instead of relying on
 *     scroll-snap-align — that's the only way to keep them in sync
 *     with a free-form translateY container
 *   • IntersectionObserver active-item detection removed: activeIndex
 *     now comes directly from the gesture's snap commit
 *   • Tap detection routed through use-gesture filterTaps so swipes
 *     don't fire links/buttons by accident
 *
 * Still deferred to later phases:
 *   - Phase 3: useNetworkQuality + buffer manager
 *   - Phase 4: useHlsPlayer
 *   - Phase 5: pull-to-refresh + end-of-feed card + chip bar v2
 *   - Phase 6: keyboard shortcuts (basic ↑↓ + space already wired here)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
// Wave 30c (2026-05-11) — BgmPlayer removed. With the wolf-player CSP
// fix landing in Wave 30a, the wolf player now auto-plays the "scroll"
// playlist (via lib/audio/playlists.ts → playlistForRoute("/scroll"))
// using the SAME YouTube IFrame API. Keeping BgmPlayer mounted here
// caused two concurrent YT iframes on /scroll, both fighting for the
// audio output. Symptom : the feed appeared to "freeze" / not respond.
// import { BgmPlayer } from "../BgmPlayer";
import {
  FeedItemVideo,
  FeedItemMoment,
} from "./FeedItem";
import { FeedPlayerPool, type PoolItem } from "./FeedPlayerPool";
import { useFeedGesture } from "./hooks/useFeedGesture";
import { useNetworkQuality } from "./hooks/useNetworkQuality";
import { useFeedBuffer } from "./hooks/useFeedBuffer";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useLiveMatch } from "./hooks/useLiveMatch";
import { useRecommendationFeed } from "./hooks/useRecommendationFeed";
import { EndOfFeedCard } from "./EndOfFeedCard";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";
import { KeyboardHelpOverlay } from "./KeyboardHelpOverlay";
import { LiveBanner } from "./LiveBanner";
import { OfflineBanner, useIsOffline } from "./OfflineBanner";
import { FeedItemSkeleton } from "./FeedItemSkeleton";
import { StreakBadge } from "./StreakBadge";
import {
  ScrollSettingsDrawer,
  useScrollSettings,
} from "./ScrollSettingsDrawer";
import { OnboardingModal } from "./OnboardingModal";
import { useAffinityStore } from "./hooks/useAffinityStore";
import { FeedTabBar } from "./FeedTabBar";
import { useScrollRestore } from "./hooks/useScrollRestore";
import { ScrollChipBar, type ChipFilters } from "@/components/scroll/ScrollChipBar";
import type {
  FeedItem,
  VideoFeedItem,
} from "@/components/scroll/ScrollFeed";
import type { RecommendedKillRow } from "@/lib/supabase/recommendations";
import { track } from "@/lib/analytics/track";

/**
 * Recommendation engine feature flag.
 *
 * V30 (Wave 21.4) — DEFAULT FLIPPED TO ON. The flag remains an
 * `NEXT_PUBLIC_*` env var so an operator can kill-switch it during
 * an outage by setting `NEXT_PUBLIC_RECOMMENDATIONS_ENABLED=false` on
 * Vercel. Was previously default-OFF, which meant every visitor saw
 * an identical weighted-shuffle feed regardless of personal taste.
 *
 * Default rationale (post-V21) :
 * * Anchors now carry dwell-fraction + are ranked top-K (high
 *   engagement wins over recency alone).
 * * Cold start still works — when no anchors exist, the API
 *   returns `{rows: [], fallback: true}` and the feed falls back
 *   to the SSR seed unchanged.
 * * Anti-repeat caps in `weightedShuffle` (V25) ensure even the
 *   recommended-then-folded list stays varied.
 *
 * To kill : set `NEXT_PUBLIC_RECOMMENDATIONS_ENABLED=false` on
 * Vercel + redeploy. The flag is read at build time.
 */
const RECOMMENDATIONS_ENABLED =
  process.env.NEXT_PUBLIC_RECOMMENDATIONS_ENABLED !== "false";

/**
 * Viewport-bounded virtualisation window. Items where
 * `|index - activeIndex| > VIRTUAL_WINDOW` don't render — they live in
 * the data array (so gesture math, scroll-restore, deep-link jumps
 * still work) but no FeedItem fiber is allocated for them.
 *
 * 2 = render the active item, 1 ahead, 1 behind, plus 1 extra each
 * direction for swipe-overshoot cushioning. That's 5 mounted items
 * max — same shape as the FeedPlayerPool's video-slot capacity, so
 * we never have an FeedItem overlay without a matching video lane.
 *
 * If raised : larger initial-mount cost (each FeedItem is ~7 KB of
 * DOM after sidebar + overlays). If lowered to 1 : pinching a
 * fast swipe past the active item briefly shows a black gap before
 * the next FeedItem mounts. 2 is the empirical sweet spot.
 */
const VIRTUAL_WINDOW = 2;

/**
 * Build a minimal VideoFeedItem from a RecommendedKillRow. Kept
 * deliberately conservative — we don't have the per-game roster
 * snapshot here (that lives in kc_matches.json server-side), so player
 * IGNs default to null and the consumer falls back to "?" naming.
 */
function recommendationToFeedItem(row: RecommendedKillRow): VideoFeedItem | null {
  const k = row.kill;
  if (!k.id || !k.clip_url_vertical || !k.thumbnail_url) return null;
  return {
    kind: "video",
    id: k.id,
    score: row.similarity, // raw cosine — re-ranking happens elsewhere if needed
    killerPlayerId: k.killer_player_id,
    killerChampion: k.killer_champion ?? "?",
    victimChampion: k.victim_champion ?? "?",
    killerName: null,
    victimName: null,
    minuteBucket: k.game_minute_bucket,
    fightType: k.fight_type,
    clipVertical: k.clip_url_vertical,
    clipVerticalLow: k.clip_url_vertical_low ?? null,
    clipHorizontal: k.clip_url_horizontal ?? null,
    hlsMasterUrl: k.hls_master_url ?? null,
    assetsManifest: k.assets_manifest ?? null,
    thumbnail: k.thumbnail_url ?? null,
    highlightScore: k.highlight_score ?? null,
    avgRating: k.avg_rating ?? null,
    ratingCount: k.rating_count,
    commentCount: k.comment_count ?? 0,
    aiDescription: k.ai_description ?? null,
    aiDescriptionFr: k.ai_description_fr ?? null,
    aiDescriptionEn: k.ai_description_en ?? null,
    aiDescriptionKo: k.ai_description_ko ?? null,
    aiDescriptionEs: k.ai_description_es ?? null,
    aiTags: k.ai_tags ?? [],
    multiKill: k.multi_kill,
    isFirstBlood: k.is_first_blood,
    kcInvolvement: k.tracked_team_involvement,
    gameTimeSeconds: k.game_time_seconds ?? 0,
    gameNumber: k.games?.game_number ?? 1,
    matchExternalId: k.games?.matches?.external_id ?? "",
    matchStage: k.games?.matches?.stage ?? "LEC",
    matchDate: k.games?.matches?.scheduled_at ?? k.created_at,
    opponentCode: "LEC",
    kcWon: null,
    matchScore: null,
  };
}

interface Props {
  items: FeedItem[];
  videoCount?: number;
  initialKillId?: string;
  chipFilters?: ChipFilters;
  rosterChips?: { id: string; ign: string; role: "TOP" | "JGL" | "MID" | "ADC" | "SUP" }[];
  /** V26 — active feed tab from the URL. The server already
   *  ordered the items list according to this ; the prop is just
   *  for the FeedTabBar's active-pill state. */
  feedTab?: "pour-toi" | "recent" | "top-semaine";
}

export function ScrollFeedV2({
  items: itemsProp,
  videoCount = 0,
  initialKillId,
  chipFilters,
  rosterChips,
  feedTab = "pour-toi",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [itemHeight, setItemHeight] = useState(0);
  const [muted, setMuted] = useState(true);
  // V20 (Wave 21.6) — local-storage settings (auto-advance for now,
  // more later). The hook re-reads on the kc:scroll-settings-changed
  // CustomEvent so drawer toggles propagate immediately to the pool.
  const settings = useScrollSettings();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // V22 + V23 (Wave 24.1) — affinity store (player + champion
  // long-term dwell aggregation). Listens for the dwell event from
  // V1 / V21 and accumulates per-facet scores in localStorage with
  // 21-day decay. Top-K used to bias recommendations.
  const affinity = useAffinityStore();
  // V22+V23 — listen for dwell events broadcast by FeedItem (V21) and
  // route them into the affinity store. We piggy-back on the same
  // CustomEvent so we don't double-track.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onDwell = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          itemId?: string;
          dwellFraction?: number | null;
        }>
      ).detail;
      const frac = detail?.dwellFraction;
      const id = detail?.itemId;
      if (!id || typeof frac !== "number" || !Number.isFinite(frac)) return;
      // Find the matching item to extract player + champions.
      const found = itemsProp.find((it) => it.id === id);
      if (!found || found.kind !== "video") return;
      affinity.recordDwell(
        found.killerPlayerId,
        found.killerChampion,
        found.victimChampion,
        frac,
      );
    };
    window.addEventListener("kc:clip-dwell-recorded", onDwell as EventListener);
    return () =>
      window.removeEventListener(
        "kc:clip-dwell-recorded",
        onDwell as EventListener,
      );
  }, [itemsProp, affinity]);
  const [isDesktop, setIsDesktop] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [brokenIds, setBrokenIds] = useState<Set<string>>(() => new Set());

  // ─── Reshuffle state (Phase 5 — drives PTR) ───────────────────────
  // Items live in client state so we can re-shuffle on PTR without a
  // server round-trip. Initial state mirrors the server-rendered list.
  const [items, setItems] = useState(itemsProp);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // Sync prop changes (e.g. URL filter changes triggering server re-render).
  useEffect(() => setItems(itemsProp), [itemsProp]);

  // ─── feed.view analytics — fired once on mount ────────────────────
  useEffect(() => {
    // Snapshot the chip filters into a flat metadata blob (no nested
    // objects > 1KB, no PII). The /api/track sanitiser drops anything
    // suspicious server-side, but keeping it lean is cheaper.
    const meta: Record<string, unknown> = { count: itemsProp.length };
    if (chipFilters) {
      if (chipFilters.player) meta.player = chipFilters.player;
      if (chipFilters.fight) meta.fight = chipFilters.fight;
      if (chipFilters.side) meta.side = chipFilters.side;
      if (chipFilters.multiKillsOnly) meta.multi = true;
      if (chipFilters.firstBloodsOnly) meta.fb = true;
    }
    track("feed.view", { metadata: meta });
    // Run once per mount — re-runs on URL filter changes via remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Network-driven quality (Phase 3) ─────────────────────────────
  const { quality, useLowQuality, effectiveType } = useNetworkQuality();

  // ─── Live mode (Wave 4 P1) ────────────────────────────────────────
  // Polls /api/live/kc-status every 60s. When KC has a match in
  // `state='inProgress'`, isLive flips to true and we:
  //   1. crank the SSR feed refresh from 30s → 15s (router.refresh)
  //   2. mount the LiveBanner above the feed (red, animated, tappable)
  //   3. fire feed.mode_live_entered / _exited analytics with duration
  const live = useLiveMatch();
  const liveStartRef = useRef<{ matchId?: string; startedAt: number } | null>(null);
  const router = useRouter();

  // Fire mode_live_entered / mode_live_exited analytics on transitions.
  // We track the entry timestamp so the exit event can carry duration_ms.
  useEffect(() => {
    if (live.isLive) {
      // Already in live mode for the same match → no-op (avoids double-firing
      // on every poll while live).
      if (liveStartRef.current?.matchId === live.matchId) return;
      // Different match (or first entry) → close the previous if any, then open.
      if (liveStartRef.current) {
        track("feed.mode_live_exited", {
          metadata: {
            match_id: liveStartRef.current.matchId ?? null,
            duration_ms: Date.now() - liveStartRef.current.startedAt,
          },
        });
      }
      liveStartRef.current = { matchId: live.matchId, startedAt: Date.now() };
      track("feed.mode_live_entered", {
        metadata: { match_id: live.matchId ?? null },
      });
    } else if (liveStartRef.current) {
      // Live → idle transition.
      track("feed.mode_live_exited", {
        metadata: {
          match_id: liveStartRef.current.matchId ?? null,
          duration_ms: Date.now() - liveStartRef.current.startedAt,
        },
      });
      liveStartRef.current = null;
    }
  }, [live.isLive, live.matchId]);

  // ─── Offline detection (Wave 6 — Agent AB) ────────────────────────
  // Drives the bottom OfflineBanner + pauses the SSR auto-refresh loop
  // below so we don't burn router.refresh() calls while the request will
  // 100% fail. The cached clips already in the player pool keep playing
  // because the browser already downloaded them.
  const isOffline = useIsOffline();

  // SSR feed refresh cadence — 15s when live, 30s otherwise. Single
  // setInterval whose callback dynamically reads `live.isLive` + `offline`
  // from refs so we don't reschedule on every state change (which would
  // make the first tick land at 15s+30s instead of at 15s after a live
  // flip). Pattern matches the spec's "don't remount the query — adjust
  // the option dynamically" requirement.
  const isLiveRef = useRef(live.isLive);
  useEffect(() => {
    isLiveRef.current = live.isLive;
  }, [live.isLive]);
  const isOfflineRef = useRef(isOffline);
  useEffect(() => {
    isOfflineRef.current = isOffline;
  }, [isOffline]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    let timeoutId: number | null = null;
    const tick = () => {
      // Skip the actual refresh while offline — the request would fail
      // and we'd just waste a network attempt + risk noisy errors. The
      // banner is already telling the user; let cached content shine.
      if (!isOfflineRef.current) {
        try {
          router.refresh();
        } catch {
          // ignore — refresh is best-effort
        }
      }
      const next = isLiveRef.current ? 15_000 : 30_000;
      timeoutId = window.setTimeout(tick, next);
    };
    // Bootstrap with the current cadence so the first tick aligns.
    timeoutId = window.setTimeout(tick, isLiveRef.current ? 15_000 : 30_000);
    return () => {
      if (timeoutId != null) window.clearTimeout(timeoutId);
    };
  }, [router]);

  // ─── Viewport sizing ──────────────────────────────────────────────
  // CRITICAL: on mobile (iOS Safari especially), clientHeight can be 0
  // at first mount if the container's height is computed via dvh/svh.
  // ResizeObserver catches the value as soon as it's measurable, AND
  // we fall back to window.innerHeight which is always non-zero.
  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      const measured = el?.clientHeight ?? 0;
      // Always use a non-zero value — 0 makes videos invisible (audio-only bug)
      const h = measured > 0 ? measured : window.innerHeight;
      setItemHeight(h);
    };
    update();
    // Re-measure on next frame too (iOS Safari sometimes lies on first paint)
    const raf = requestAnimationFrame(update);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    // ResizeObserver catches container height changes (including when
    // dvh/svh values resolve after first paint on mobile)
    let ro: ResizeObserver | null = null;
    if (containerRef.current && typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(() => update());
      ro.observe(containerRef.current);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
      ro?.disconnect();
    };
  }, []);

  // ─── Filter broken items ──────────────────────────────────────────
  const visibleItems = useMemo(
    () => (brokenIds.size === 0 ? items : items.filter((it) => !brokenIds.has(it.id))),
    [items, brokenIds],
  );

  // ─── Scroll restore (Wave 6 — Agent AB) ───────────────────────────
  // sessionStorage-backed, 30-min expiry. Returns a non-null index when
  // the user is returning from a /kill/[id] back-nav AND the same kill
  // is still in the current items[]. We let an explicit ?kill=<id>
  // deep link override the restore (hasDeepLink=true).
  const { restoreIndex, persist: persistScrollPos } = useScrollRestore({
    items: visibleItems,
    hasDeepLink: !!initialKillId,
  });

  // ─── Resolve initial index from ?kill=<id> deep link or restore ──
  // Priority: explicit deep link > sessionStorage restore > top of feed.
  const initialIndex = useMemo(() => {
    if (initialKillId) {
      const idx = visibleItems.findIndex((it) => it.id === initialKillId);
      if (idx >= 0) return idx;
    }
    if (restoreIndex != null) return restoreIndex;
    return 0;
  }, [initialKillId, restoreIndex, visibleItems]);

  // ─── URL state sync — fired on every snap commit ─────────────────
  const handleActiveChange = (idx: number) => {
    const item = visibleItems[idx];
    // Always persist the latest position to sessionStorage — even
    // index 0, so a user who scrolled to item 5, scrolled back to 0,
    // then navigated away gets the correct restore on return.
    persistScrollPos(item?.id);
    if (idx === 0) return; // don't dirty URL on the initial snap
    if (!item || typeof window === "undefined") return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("kill") !== item.id) {
        url.searchParams.set("kill", item.id);
        window.history.replaceState(window.history.state, "", url.toString());
      }
    } catch {
      // sandboxed contexts disallow history mutation — silent
    }
  };

  // ─── Gesture controller ──────────────────────────────────────────
  // We add +1 to totalItems so the gesture engine considers the virtual
  // EndOfFeedCard as a real index (visibleItems.length). The user can
  // swipe up from the last clip and land on the recommendation card.
  const { bind, y, activeIndex, jumpTo, isDragging } = useFeedGesture({
    totalItems: visibleItems.length + 1, // +1 for EndOfFeedCard slot
    itemHeight,
    initialIndex,
    onActiveChange: handleActiveChange,
  });
  const isAtEndOfFeed = activeIndex === visibleItems.length;

  // ─── Speculative buffer (PR5-A) ───────────────────────────────────
  // Two layers : thumbnail preload (15 ahead on ultra) + video manifest
  // HEAD-warmer for the next 2-3 items so HLS attach starts with a
  // primed CDN edge cache. Both adaptive to network quality.
  useFeedBuffer({
    items: visibleItems.map((it) => {
      if (it.kind === "video" || it.kind === "moment") {
        return {
          id: it.id,
          thumbnail: it.thumbnail,
          hlsMasterUrl: it.hlsMasterUrl ?? null,
          videoUrl: it.clipVertical || null,
        };
      }
      return { id: it.id, thumbnail: null, hlsMasterUrl: null, videoUrl: null };
    }),
    activeIndex,
    quality,
  });

  // ─── Apply initial deep-link jump once item heights are measured ──
  useEffect(() => {
    if (itemHeight > 0 && initialIndex > 0) {
      jumpTo(initialIndex, { instant: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemHeight]);

  // ─── Desktop / reduced-motion / network detection ────────────────
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setIsDesktop(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // (network detection now lives in useNetworkQuality — Phase 3)

  // ─── Mute persistence ────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("kc-scroll-muted");
    if (saved === "false") setMuted(false);
  }, []);
  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      localStorage.setItem("kc-scroll-muted", String(next));
      // Notify the BGM player so it can duck the music while the
      // user is listening to the cast — see AudioPlayer.tsx.
      try {
        window.dispatchEvent(
          new CustomEvent("kc:clip-unmuted", { detail: { unmuted: !next } }),
        );
      } catch {
        // CustomEvent unsupported in some sandboxes — silent
      }
      return next;
    });
  };

  // Initial sync — if mute state was persisted as "unmuted" from a
  // previous session, fire the duck event so BGM starts in ducked
  // mode rather than blasting at 100% on first paint.
  useEffect(() => {
    if (!muted) {
      try {
        window.dispatchEvent(
          new CustomEvent("kc:clip-unmuted", { detail: { unmuted: true } }),
        );
      } catch {
        // ignore
      }
    }
    // Run only when mute state changes (handled separately above on user toggle).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Full keyboard shortcuts (Phase 6) ────────────────────────────
  // Pro mode bindings: J/K next/prev, Space, M mute, L like, C comments,
  // S share, ? help overlay, Esc close. See useKeyboardShortcuts for
  // the full table — the overlay component renders the cheatsheet.
  const [shareToast, setShareToast] = useState<string | null>(null);

  const shareActiveItem = async () => {
    const active = visibleItems[activeIndex];
    if (!active || typeof window === "undefined") return;
    const url = `${window.location.origin}/scroll?kill=${active.id}`;
    const title = "KCKILLS — clip à voir";
    try {
      if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
    } catch {
      return; // user cancelled
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareToast("Lien copié !");
      window.setTimeout(() => setShareToast(null), 1800);
    } catch {
      setShareToast("Copie impossible");
      window.setTimeout(() => setShareToast(null), 1800);
    }
  };

  const { showHelp, setShowHelp } = useKeyboardShortcuts({
    onNext: () => jumpTo(activeIndex + 1),
    onPrev: () => jumpTo(activeIndex - 1),
    onToggleMute: toggleMute,
    onShare: shareActiveItem,
    // L / C not yet wired — those depend on per-item handlers that
    // live in the right sidebar (Phase 7 will hoist them up to here).
    // Esc closes the help overlay (handled inside the hook).
  });

  // V20 (Wave 21.6) — auto-advance handler. Listens for the
  // `kc:auto-advance` event the pool fires when a LIVE-slot video
  // ends while autoAdvance is on. Calls jumpTo(activeIndex+1) to
  // walk the user forward. Defensively gated on `settings.autoAdvance`
  // so a stale setting from a previous session doesn't trigger
  // unwanted advances.
  useEffect(() => {
    if (!settings.autoAdvance || typeof window === "undefined") return;
    const onAutoAdvance = () => {
      jumpTo(activeIndex + 1);
    };
    window.addEventListener("kc:auto-advance", onAutoAdvance as EventListener);
    return () =>
      window.removeEventListener(
        "kc:auto-advance",
        onAutoAdvance as EventListener,
      );
  }, [settings.autoAdvance, activeIndex, jumpTo]);

  // ─── Pool error handler ──────────────────────────────────────────
  const handlePoolError = (itemId: string) => {
    setBrokenIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  };

  // ─── Reshuffle handler — fired by PTR + EndOfFeedCard ─────────────
  const handleReshuffle = () => {
    setIsRefreshing(true);
    // Simple Fisher-Yates with a tiny artificial delay so the spinner
    // is visible (else the refresh feels accidental). The real shuffle
    // is instant — we want it to feel intentional.
    window.setTimeout(() => {
      setItems((prev) => {
        const arr = [...prev];
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      });
      jumpTo(0, { instant: true });
      setIsRefreshing(false);
    }, 350);
  };

  const poolItems: PoolItem[] = useMemo(
    () =>
      visibleItems.map((it) => {
        if (it.kind === "video" || it.kind === "moment") {
          return {
            id: it.id,
            clipVertical: it.clipVertical,
            clipVerticalLow: it.clipVerticalLow,
            clipHorizontal: it.clipHorizontal,
            hlsMasterUrl: it.hlsMasterUrl ?? null,
            assetsManifest: it.assetsManifest ?? null,
            thumbnail: it.thumbnail,
            // V42-V43 — only video items carry the analyser-derived
            // best-thumb offset (moments don't go through the same
            // analyser path).
            bestThumbnailSeconds:
              it.kind === "video" ? it.bestThumbnailSeconds ?? null : null,
          };
        }
        return {
          id: it.id,
          clipVertical: "",
          clipVerticalLow: null,
          clipHorizontal: null,
          hlsMasterUrl: null,
          assetsManifest: null,
          thumbnail: null,
        };
      }),
    [visibleItems],
  );

  // ─── Recommendation engine wire-up (Wave 11 — Agent DI) ───────────
  // Stable callback for the hook so the dependency array doesn't churn.
  // The mapper itself is pure and has no closure dependencies that
  // change at runtime.
  const toFeedItemCb = useCallback(
    (row: RecommendedKillRow) => recommendationToFeedItem(row),
    [],
  );
  const recFeed = useRecommendationFeed<FeedItem>({
    seedItems: visibleItems,
    activeIndex,
    enabled: RECOMMENDATIONS_ENABLED,
    toFeedItem: toFeedItemCb,
  });
  // Whenever the recommendation hook produces a longer list than the
  // current `items`, append the new items into the source state so
  // every downstream consumer (gesture, pool, scroll-restore) sees
  // them. We diff by id to avoid a useless re-render when nothing new
  // has landed.
  useEffect(() => {
    if (!RECOMMENDATIONS_ENABLED) return;
    if (recFeed.items.length <= items.length) return;
    setItems((prev) => {
      const seen = new Set(prev.map((it) => it.id));
      const additions = recFeed.items.filter((it) => !seen.has(it.id));
      return additions.length === 0 ? prev : [...prev, ...additions];
    });
  }, [recFeed.items, items.length]);

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] bg-black overflow-hidden"
      // Touch-action: pan-y so the browser doesn't fight the drag.
      style={{ touchAction: "pan-y", overscrollBehavior: "contain" }}
    >
      {/* BgmPlayer removed (Wave 30c) — the wolf player now handles
          /scroll audio via lib/audio/playlists.ts. */}
      {/* Live mode banner — portaled to <body> so it escapes overflow:hidden.
          Tap → jump to index 0 (most recent kill). If the feed is empty,
          the banner falls back to a Link to /match/[external_id]. */}
      <LiveBanner
        isLive={live.isLive}
        matchId={live.matchId}
        opponentCode={live.opponentCode}
        gameNumber={live.gameNumber}
        onTap={
          visibleItems.length > 0
            ? () => jumpTo(0)
            : undefined
        }
      />
      {/* Top bar — outside the motion container so it doesn't translate. */}
      <div
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-3"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top, 0.75rem))" }}
      >
        <Link href="/" className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
          <svg className="h-5 w-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </Link>
        <div className="flex flex-col items-center gap-0.5">
          <span className="font-display text-sm font-bold tracking-widest text-[var(--gold)]/80">
            KCKILLS
          </span>
          <StreakBadge />
          <span className="font-data text-[9px] uppercase tracking-widest text-[var(--gold)]/50">
            v2 · {videoCount} clips
            {effectiveType ? ` · ${effectiveType}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* V20 (Wave 21.6) — settings ⚙ button. Opens the
              ScrollSettingsDrawer with auto-advance toggle. Lives left
              of the mute button so the mute button stays the most-
              prominent action (most-used). */}
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-label="Réglages du scroll"
            aria-expanded={settingsOpen}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm hover:bg-black/80 transition-colors"
          >
            <svg
              className={`h-4 w-4 transition-colors ${
                settings.autoAdvance ? "text-[var(--gold)]" : "text-white/70"
              }`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button
            onClick={toggleMute}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm"
            aria-label={muted ? "Activer le son" : "Couper le son"}
          >
            {muted ? (
              <svg className="h-4 w-4 text-white/70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" /></svg>
            ) : (
              <svg className="h-4 w-4 text-[var(--gold)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" /></svg>
            )}
          </button>
        </div>
      </div>

      {/* V20 — settings drawer. Renders nothing when closed. */}
      <ScrollSettingsDrawer
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />

      {/* V27 (Wave 24.1) — first-visit onboarding modal. Self-gates
          on `localStorage.kc_onboarded_v1` ; renders nothing for
          returning users. Roster picks from the SSR-fetched chips. */}
      {rosterChips && rosterChips.length > 0 && (
        <OnboardingModal
          roster={rosterChips.map((p) => ({
            id: p.id,
            ign: p.ign,
            role: p.role,
          }))}
        />
      )}

      {/* V26 (Wave 24.1) — feed-tab pills (Pour toi / Récent / Top
          7j). Sticky below the top bar, above the chip bar. */}
      <FeedTabBar active={feedTab} />

      {/* Filter chip bar — sticky just below the top bar (Phase 5).
          Reuses the v1 ScrollChipBar component since the URL state
          contract is identical. */}
      {chipFilters && (
        <ScrollChipBar filters={chipFilters} rosterChips={rosterChips} />
      )}

      {/* Pull-to-refresh indicator (Phase 5) — visible only when at the
          top of the feed AND user is pulling down past 5px. */}
      <PullToRefreshIndicator
        containerY={y}
        atTop={activeIndex === 0}
        onRefresh={handleReshuffle}
        isRefreshing={isRefreshing}
      />

      {/* Pool — anchored to viewport, follows containerY */}
      {itemHeight > 0 && (
        <FeedPlayerPool
          items={poolItems}
          activeIndex={activeIndex}
          itemHeight={itemHeight}
          muted={muted}
          useLowQuality={useLowQuality}
          quality={quality}
          isDesktop={isDesktop}
          reducedMotion={reducedMotion}
          onError={handlePoolError}
          containerY={y}
          autoAdvance={settings.autoAdvance}
          speed={settings.speed}
        />
      )}

      {/* Items container — gesture-driven, items absolutely positioned.
          Wave 19.7 (2026-05-08) : viewport-bounded virtualisation.
          Only items within ±VIRTUAL_WINDOW of activeIndex render. The
          rest return null — their absolute-positioned slots don't need
          DOM nodes since the gesture engine drives container Y from
          totalItems × itemHeight, and no neighbour layout depends on
          siblings (each item is `position: absolute` at `top:
          i * itemHeight`).

          DOM impact : pre-virtualisation we mounted ~80 items (post-
          filter) on first paint → ~1 MB of <FeedItemVideo> trees on
          mobile (sidebar, image, overlays per item). With WINDOW=2 the
          mount count caps at 5 regardless of feed size, dropping the
          mobile DOM cost by ~94 %. Pool video elements are managed
          separately by FeedPlayerPool (5-slot fixed pool with portal-
          like positioning) so the LIVE/warm/cold ladder stays intact —
          virtualisation here only affects the overlay layer, not video
          playback continuity. */}
      <motion.div
        className="absolute inset-0"
        style={{ y, willChange: "transform" }}
        {...bind()}
      >
        {visibleItems.map((item, i) => {
          // Skip rendering items outside the viewport window. The map
          // still iterates the full list (cheap) but returns null for
          // far-away items so React's reconciler doesn't allocate
          // fibers for them.
          if (Math.abs(i - activeIndex) > VIRTUAL_WINDOW) return null;

          const isActive = i === activeIndex;
          const top = i * itemHeight;
          if (item.kind === "video") {
            return (
              <div
                key={`v-${item.id}`}
                style={{ position: "absolute", top, left: 0, right: 0, height: itemHeight }}
              >
                <FeedItemVideo
                  item={item}
                  index={i}
                  total={visibleItems.length}
                  itemHeight={itemHeight}
                  isActive={isActive}
                  onAutoSkipNext={() => jumpTo(i + 1)}
                />
              </div>
            );
          }
          if (item.kind === "moment") {
            return (
              <div
                key={`m-${item.id}`}
                style={{ position: "absolute", top, left: 0, right: 0, height: itemHeight }}
              >
                <FeedItemMoment
                  item={item}
                  index={i}
                  total={visibleItems.length}
                  itemHeight={itemHeight}
                  isActive={isActive}
                  onAutoSkipNext={() => jumpTo(i + 1)}
                />
              </div>
            );
          }
          return (
            <div
              key={`a-${item.id}-${i}`}
              data-feed-item
              data-feed-index={i}
              data-feed-id={item.id}
              style={{
                position: "absolute",
                top,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
              className="flex items-center justify-center bg-[var(--bg-elevated)] text-white/40 text-sm"
            >
              (legacy aggregate item)
            </div>
          );
        })}

        {/* Skeleton placeholder (Wave 6 — Agent AB) — sits at the tail
            slot WHEN the user is within the last 2 items AND a refresh
            is in flight (isRefreshing) so the next snap doesn't drop into
            a black void while the SSR re-fetch resolves. The
            EndOfFeedCard renders one slot further down. */}
        {visibleItems.length > 0 &&
          itemHeight > 0 &&
          isRefreshing &&
          activeIndex >= Math.max(0, visibleItems.length - 2) && (
            <div
              key="feed-skeleton-tail"
              style={{
                position: "absolute",
                top: visibleItems.length * itemHeight,
                left: 0,
                right: 0,
                height: itemHeight,
              }}
            >
              <FeedItemSkeleton itemHeight={itemHeight} />
            </div>
          )}

        {/* End-of-feed card (Phase 5) — virtual item at index N.
            Same gesture model as real items, the user lands here by
            swiping past the last clip. When the skeleton is being shown
            above (refreshing tail), we shift the EndOfFeedCard down by
            one slot so both can coexist visibly during the brief refresh
            window. */}
        {visibleItems.length > 0 && itemHeight > 0 && (
          <div
            key="end-of-feed"
            style={{
              position: "absolute",
              top:
                (visibleItems.length +
                  (isRefreshing && activeIndex >= Math.max(0, visibleItems.length - 2)
                    ? 1
                    : 0)) *
                itemHeight,
              left: 0,
              right: 0,
              height: itemHeight,
            }}
          >
            <EndOfFeedCard
              itemHeight={itemHeight}
              onReshuffle={handleReshuffle}
              totalSeen={visibleItems.length}
            />
          </div>
        )}
      </motion.div>

      {/* Wave 6 — bottom offline banner. Slides in when navigator.onLine
          flips false, fires feed.offline_entered/exited analytics with
          a duration_ms metric. Doesn't block any interaction (pointer-
          events: none on the wrapper). */}
      <OfflineBanner />

      {/* Drag indicator — V11 (Wave 21.2) : was 5 hardcoded dots which
          collapsed all positions of a 100+ feed into the same 5 slots.
          Now renders a single thin progress rail with the thumb position
          mapped linearly across the full feed length. Power-user signal :
          quickly see "I'm at 12/87" without opening anything. */}
      {visibleItems.length > 1 && itemHeight > 0 && (
        <div
          className="fixed right-1.5 top-[10%] bottom-[10%] z-50 w-0.5 rounded-full bg-white/10 pointer-events-none"
          aria-hidden
        >
          <span
            className="absolute left-0 right-0 rounded-full bg-[var(--gold)] transition-all"
            style={{
              top: `${(activeIndex / Math.max(1, visibleItems.length)) * 100}%`,
              height: `${
                Math.max(4, (1 / visibleItems.length) * 100)
              }%`,
              minHeight: 6,
            }}
          />
        </div>
      )}

      {/* isDragging hint — fade overlays during active swipe */}
      {isDragging && <div className="pointer-events-none fixed inset-0 z-30" />}

      {/* Keyboard help overlay — toggled by ? on desktop */}
      <KeyboardHelpOverlay open={showHelp} onClose={() => setShowHelp(false)} />

      {/* Share toast — fires from S keyboard shortcut when clipboard fallback
          kicks in (desktop, no Web Share API). Top-centered, auto-dismisses. */}
      {shareToast && (
        <div className="pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-[200] rounded-full bg-black/85 backdrop-blur-sm px-4 py-2 text-xs font-bold text-[var(--gold)] shadow-lg">
          {shareToast}
        </div>
      )}

      {/* Discreet "?" hint pill — only on desktop, hidden on mobile.
          Lets the user discover the keyboard shortcuts without poking
          random keys. Disappears once they've opened the overlay once. */}
      {isDesktop && !showHelp && (
        <button
          onClick={() => setShowHelp(true)}
          className="hidden md:flex fixed bottom-6 left-6 z-40 h-10 w-10 items-center justify-center rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-white/65 transition-colors hover:bg-black/80 hover:text-[var(--gold)] hover:border-[var(--gold)]/40"
          aria-label="Raccourcis clavier"
        >
          <span className="font-data text-base font-bold">?</span>
        </button>
      )}

      {/* Empty state */}
      {visibleItems.length === 0 && itemHeight > 0 && (
        <div
          className="flex items-center justify-center"
          style={{ height: `${itemHeight}px` }}
        >
          <div className="text-center max-w-md px-6">
            <div className="text-6xl mb-6">{"\u2694\uFE0F"}</div>
            <h1 className="font-display text-3xl font-black text-[var(--gold)] mb-3 uppercase">
              Aucun clip
            </h1>
            <p className="text-sm text-[var(--text-muted)] mb-6">
              Le worker travaille en background, reviens dans quelques minutes.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
