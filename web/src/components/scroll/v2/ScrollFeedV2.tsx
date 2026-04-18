"use client";

/**
 * ScrollFeedV2 — Phase 1 orchestrator.
 *
 * What's done in Phase 1:
 *   • 5-slot video pool that follows the active item via translate3d
 *     (FeedPlayerPool) — replaces the per-item <video> model of v1
 *   • Items render only their UI overlay (FeedItem*) — no video
 *   • Active item detection via IntersectionObserver — same pattern as
 *     v1 since CSS scroll-snap is still the gesture engine for now
 *
 * What's deferred to later phases:
 *   • Phase 2 — framer-motion + use-gesture replaces scroll-snap
 *   • Phase 3 — useNetworkQuality wires bitrate switching
 *   • Phase 4 — useHlsPlayer attaches HLS streams
 *   • Phase 5 — pull-to-refresh + end-of-feed card
 *   • Phase 6 — keyboard shortcuts
 *
 * Memory model the pool enforces:
 *   - 5 <video> elements total, REGARDLESS of how many items in the feed
 *   - 1, 200, 10000 clips → same memory footprint at the player layer
 *   - Items themselves are cheap DOM (img poster + overlays = ~3KB each)
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  FeedItemVideo,
  FeedItemMoment,
} from "./FeedItem";
import { FeedPlayerPool, type PoolItem } from "./FeedPlayerPool";
import type { FeedItem } from "@/components/scroll/ScrollFeed";

interface Props {
  items: FeedItem[];
  videoCount?: number;
  initialKillId?: string;
}

export function ScrollFeedV2({ items, videoCount = 0, initialKillId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [itemHeight, setItemHeight] = useState(0);
  const [muted, setMuted] = useState(true);
  const [useLowQuality, setUseLowQuality] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  /** IDs of items the pool reported as broken — filtered out. */
  const [brokenIds, setBrokenIds] = useState<Set<string>>(() => new Set());

  // ─── Viewport sizing ──────────────────────────────────────────────
  useEffect(() => {
    const update = () => {
      // 100dvh — accounts for mobile browser chrome bars correctly.
      // Use the container if mounted (safer than reading window.innerHeight
      // which lags during iOS toolbar collapse).
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

  // ─── Desktop / reduced-motion / network detection ─────────────────
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

  useEffect(() => {
    type Conn = { effectiveType?: string; addEventListener?: (type: string, fn: () => void) => void; removeEventListener?: (type: string, fn: () => void) => void };
    const conn = (navigator as unknown as { connection?: Conn }).connection;
    if (!conn) return;
    const check = () => {
      const eff = conn.effectiveType ?? "";
      setUseLowQuality(eff === "2g" || eff === "slow-2g" || eff === "3g");
    };
    check();
    conn.addEventListener?.("change", check);
    return () => conn.removeEventListener?.("change", check);
  }, []);

  // ─── Mute persistence ─────────────────────────────────────────────
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

  // ─── Active item detection (Phase 1: IntersectionObserver) ────────
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the highest intersection ratio — that's
        // the "active" item in a snap-y container. Stable even during
        // half-scrolls thanks to threshold steps.
        let bestRatio = 0;
        let bestIdx: number | null = null;
        for (const e of entries) {
          const idxAttr = (e.target as HTMLElement).dataset.feedIndex;
          if (idxAttr == null) continue;
          if (e.isIntersecting && e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            bestIdx = parseInt(idxAttr, 10);
          }
        }
        if (bestIdx != null && bestRatio > 0.5) setActiveIndex(bestIdx);
      },
      {
        root,
        threshold: [0.4, 0.6, 0.8, 1.0],
      },
    );
    const itemEls = root.querySelectorAll<HTMLElement>("[data-feed-item]");
    itemEls.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [items.length]);

  // ─── Initial scroll (deep link via ?kill=<id>) ────────────────────
  useEffect(() => {
    if (!initialKillId) return;
    const root = containerRef.current;
    if (!root) return;
    const t = window.setTimeout(() => {
      const target = root.querySelector<HTMLElement>(
        `[data-feed-id="${CSS.escape(initialKillId)}"]`,
      );
      if (target) target.scrollIntoView({ behavior: "auto", block: "start" });
    }, 0);
    return () => window.clearTimeout(t);
  }, [initialKillId]);

  // ─── URL state — reflect active item ─────────────────────────────
  useEffect(() => {
    if (items.length === 0 || activeIndex < 0 || activeIndex >= items.length) return;
    const item = items[activeIndex];
    if (!item) return;
    if (typeof window === "undefined") return;
    if (activeIndex === 0) return; // don't dirty URL on cold load
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("kill") !== item.id) {
        url.searchParams.set("kill", item.id);
        window.history.replaceState(window.history.state, "", url.toString());
      }
    } catch {
      // sandboxed contexts disallow this — silent
    }
  }, [activeIndex, items]);

  // ─── Pool error handler — drop broken items from the feed ─────────
  const handlePoolError = (itemId: string) => {
    setBrokenIds((prev) => {
      if (prev.has(itemId)) return prev;
      const next = new Set(prev);
      next.add(itemId);
      return next;
    });
  };

  // ─── Filter out broken items + project into PoolItem[] ────────────
  const visibleItems =
    brokenIds.size === 0 ? items : items.filter((it) => !brokenIds.has(it.id));

  const poolItems: PoolItem[] = visibleItems.map((it) => {
    if (it.kind === "video" || it.kind === "moment") {
      return {
        id: it.id,
        clipVertical: it.clipVertical,
        clipVerticalLow: it.clipVerticalLow,
        clipHorizontal: it.clipHorizontal,
        thumbnail: it.thumbnail,
      };
    }
    // Aggregate items have no clip — give the pool an empty src so it
    // skips them. The UI layer renders the splash-art card on top.
    return { id: it.id, clipVertical: "", clipVerticalLow: null, clipHorizontal: null, thumbnail: null };
  });

  return (
    <div
      ref={containerRef}
      className="scroll-container fixed inset-0 z-[60] bg-black"
    >
      {/* Top bar */}
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

      {/* The pool floats above all items, follows active via translate3d */}
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
        />
      )}

      {/* Items — pure UI overlays, no video */}
      {visibleItems.map((item, i) => {
        const isActive = i === activeIndex;
        if (item.kind === "video") {
          return (
            <FeedItemVideo
              key={`v-${item.id}`}
              item={item}
              index={i}
              total={visibleItems.length}
              itemHeight={itemHeight}
              isActive={isActive}
            />
          );
        }
        if (item.kind === "moment") {
          return (
            <FeedItemMoment
              key={`m-${item.id}`}
              item={item}
              index={i}
              total={visibleItems.length}
              itemHeight={itemHeight}
              isActive={isActive}
            />
          );
        }
        // Aggregate (legacy splash-art) — render a minimal placeholder for now.
        return (
          <div
            key={`a-${item.id}-${i}`}
            data-feed-item
            data-feed-index={i}
            data-feed-id={item.id}
            style={{ height: `${itemHeight}px` }}
            className="flex items-center justify-center bg-[var(--bg-elevated)] text-white/40 text-sm"
          >
            (legacy aggregate item — Phase 1 minimal render)
          </div>
        );
      })}

      {/* Empty state */}
      {visibleItems.length === 0 && (
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
