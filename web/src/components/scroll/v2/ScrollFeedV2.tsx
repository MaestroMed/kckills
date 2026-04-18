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
import {
  FeedItemVideo,
  FeedItemMoment,
} from "./FeedItem";
import { FeedPlayerPool, type PoolItem } from "./FeedPlayerPool";
import { useFeedGesture } from "./hooks/useFeedGesture";
import { useNetworkQuality } from "./hooks/useNetworkQuality";
import { useFeedBuffer } from "./hooks/useFeedBuffer";
import type { FeedItem } from "@/components/scroll/ScrollFeed";

interface Props {
  items: FeedItem[];
  videoCount?: number;
  initialKillId?: string;
}

export function ScrollFeedV2({ items, videoCount = 0, initialKillId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [itemHeight, setItemHeight] = useState(0);
  const [muted, setMuted] = useState(true);
  const [isDesktop, setIsDesktop] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [brokenIds, setBrokenIds] = useState<Set<string>>(() => new Set());

  // ─── Network-driven quality (Phase 3) ─────────────────────────────
  const { quality, useLowQuality, effectiveType } = useNetworkQuality();

  // ─── Viewport sizing ──────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      const el = containerRef.current;
      const h = el?.clientHeight ?? window.innerHeight;
      setItemHeight(h);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
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
  const { bind, y, activeIndex, jumpTo, isDragging } = useFeedGesture({
    totalItems: visibleItems.length,
    itemHeight,
    initialIndex,
    onActiveChange: handleActiveChange,
  });

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

  // ─── Basic keyboard nav (Phase 6 will add full set) ──────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        jumpTo(activeIndex + 1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        jumpTo(activeIndex - 1);
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMute();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeIndex, jumpTo]);

  // ─── Pool error handler ──────────────────────────────────────────
  const handlePoolError = (itemId: string) => {
    setBrokenIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
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
            thumbnail: it.thumbnail,
          };
        }
        return {
          id: it.id,
          clipVertical: "",
          clipVerticalLow: null,
          clipHorizontal: null,
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
