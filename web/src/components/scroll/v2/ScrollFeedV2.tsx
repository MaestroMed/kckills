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

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
// BgmPlayer disabled — Invidious URL blocked by CSP. Re-enable once
// we host MP3s on R2 (clips.kckills.com is already CSP-allowed).
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
import { EndOfFeedCard } from "./EndOfFeedCard";
import { PullToRefreshIndicator } from "./PullToRefreshIndicator";
import { KeyboardHelpOverlay } from "./KeyboardHelpOverlay";
import { ScrollChipBar, type ChipFilters } from "@/components/scroll/ScrollChipBar";
import type { FeedItem } from "@/components/scroll/ScrollFeed";

interface Props {
  items: FeedItem[];
  videoCount?: number;
  initialKillId?: string;
  chipFilters?: ChipFilters;
  rosterChips?: { id: string; ign: string; role: "TOP" | "JGL" | "MID" | "ADC" | "SUP" }[];
}

export function ScrollFeedV2({
  items: itemsProp,
  videoCount = 0,
  initialKillId,
  chipFilters,
  rosterChips,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [itemHeight, setItemHeight] = useState(0);
  const [muted, setMuted] = useState(true);
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

  // ─── Network-driven quality (Phase 3) ─────────────────────────────
  const { quality, useLowQuality, effectiveType } = useNetworkQuality();

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

  // ─── Resolve initial index from ?kill=<id> deep link ─────────────
  const initialIndex = useMemo(() => {
    if (!initialKillId) return 0;
    const idx = visibleItems.findIndex((it) => it.id === initialKillId);
    return idx >= 0 ? idx : 0;
  }, [initialKillId, visibleItems]);

  // ─── URL state sync — fired on every snap commit ─────────────────
  const handleActiveChange = (idx: number) => {
    if (idx === 0) return; // don't dirty URL on the initial snap
    const item = visibleItems[idx];
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

  // ─── Speculative thumbnail buffer (Phase 3) ───────────────────────
  // Preloads thumbnails for items 3-10 ahead so fast flicks never
  // reveal a blank poster. Skipped on "low" network quality.
  useFeedBuffer({
    items: visibleItems.map((it) => ({
      id: it.id,
      thumbnail: it.kind === "video" || it.kind === "moment" ? it.thumbnail : null,
    })),
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
      return next;
    });
  };

  // ─── Full keyboard shortcuts (Phase 6) ────────────────────────────
  // Pro mode bindings: J/K next/prev, Space, M mute, L like, C comments,
  // S share, ? help overlay, Esc close. See useKeyboardShortcuts for
  // the full table — the overlay component renders the cheatsheet.
  const { showHelp, setShowHelp } = useKeyboardShortcuts({
    onNext: () => jumpTo(activeIndex + 1),
    onPrev: () => jumpTo(activeIndex - 1),
    onToggleMute: toggleMute,
    // L / C / S not yet wired — those depend on per-item handlers that
    // live in the right sidebar (Phase 7 will hoist them up to here).
    // Esc closes the help overlay (handled inside the hook).
  });

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
            thumbnail: it.thumbnail,
          };
        }
        return {
          id: it.id,
          clipVertical: "",
          clipVerticalLow: null,
          clipHorizontal: null,
          hlsMasterUrl: null,
          thumbnail: null,
        };
      }),
    [visibleItems],
  );

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-[60] bg-black overflow-hidden"
      // Touch-action: pan-y so the browser doesn't fight the drag.
      style={{ touchAction: "pan-y", overscrollBehavior: "contain" }}
    >
      {/* BgmPlayer disabled — see import comment */}
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
        <div className="flex flex-col items-center">
          <span className="font-display text-sm font-bold tracking-widest text-[var(--gold)]/80">
            KCKILLS
          </span>
          <span className="font-data text-[9px] uppercase tracking-widest text-[var(--gold)]/50">
            v2 · {videoCount} clips
            {effectiveType ? ` · ${effectiveType}` : ""}
          </span>
        </div>
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
          isDesktop={isDesktop}
          reducedMotion={reducedMotion}
          onError={handlePoolError}
          containerY={y}
        />
      )}

      {/* Items container — gesture-driven, items absolutely positioned. */}
      <motion.div
        className="absolute inset-0"
        style={{ y, willChange: "transform" }}
        {...bind()}
      >
        {visibleItems.map((item, i) => {
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

        {/* End-of-feed card (Phase 5) — virtual item at index N.
            Same gesture model as real items, the user lands here by
            swiping past the last clip. */}
        {visibleItems.length > 0 && itemHeight > 0 && (
          <div
            key="end-of-feed"
            style={{
              position: "absolute",
              top: visibleItems.length * itemHeight,
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

      {/* Drag indicator — subtle dot grid showing position in feed */}
      {visibleItems.length > 1 && (
        <div className="fixed right-2 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-1">
          {visibleItems.slice(0, 5).map((_, i) => {
            const offset = activeIndex - 2 + i;
            const isActive = offset === activeIndex;
            const inRange = offset >= 0 && offset < visibleItems.length;
            return (
              <span
                key={i}
                className={`block h-1 w-1 rounded-full transition-all ${
                  isActive
                    ? "bg-[var(--gold)] h-2"
                    : inRange
                    ? "bg-white/40"
                    : "bg-white/10"
                }`}
              />
            );
          })}
        </div>
      )}

      {/* isDragging hint — fade overlays during active swipe */}
      {isDragging && <div className="pointer-events-none fixed inset-0 z-30" />}

      {/* Keyboard help overlay — toggled by ? on desktop */}
      <KeyboardHelpOverlay open={showHelp} onClose={() => setShowHelp(false)} />

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
