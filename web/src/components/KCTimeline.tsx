"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { m, AnimatePresence } from "motion/react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ERAS, type Era } from "@/lib/eras";

/**
 * Two interaction modes :
 *
 *  - `"navigate"` (default) : clicking a card pushes /era/[id]. Used on
 *    the marketing/landing surfaces where the timeline is a portal into
 *    the long-form era pages.
 *
 *  - `"filter"` : clicking a card calls `onEraSelect(eraId)` (or
 *    `onEraSelect(null)` if the user re-clicks the active card to clear
 *    the filter) and applies the greyscale dimming to non-selected
 *    cards per CLAUDE.md §6.2. Used by HomeTimelineFeed to wire the
 *    timeline to the kills feed below it.
 */
export type KCTimelineMode = "navigate" | "filter";

export interface KCTimelineProps {
  mode?: KCTimelineMode;
  /** Currently selected era id. Only meaningful in `mode="filter"`. */
  selectedEraId?: string | null;
  /** Callback fired when the user clicks a card in `mode="filter"`. The
   *  argument is the new selection — `null` means "clear filter". */
  onEraSelect?: (eraId: string | null) => void;
}

/**
 * Horizontal scrolling timeline with:
 *  - Drag-to-scroll via Pointer Events
 *  - Click-to-navigate (mode="navigate") OR click-to-filter
 *    (mode="filter") via event delegation at the container level
 *    (setPointerCapture reroutes click events to the captured element,
 *    which is why individual card onClick handlers don't fire during a drag
 *    session — so we delegate to the container and resolve the card via
 *    data-era-id on the closest ancestor)
 *  - Hover-delay popup (1.5s sustained hover opens a cinematic full-image lightbox)
 *  - Keyboard navigation (arrow keys)
 *  - Vertical wheel remapped to horizontal scroll
 *  - Native touch swipe (touch-action: pan-x)
 *  - prefers-reduced-motion : grayscale + scale transitions snap instantly,
 *    no spring on the cards (the GPU-cheap opacity dim still applies).
 */
export function KCTimeline({
  mode = "navigate",
  selectedEraId = null,
  onEraSelect,
}: KCTimelineProps = {}) {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  const [popupEra, setPopupEra] = useState<Era | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Read OS-level prefers-reduced-motion so we can skip the spring/scale
  // transitions for users who opted out of motion. The mql.matches read
  // is SSR-safe — useEffect only runs client-side.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    try {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    } catch {
      // Safari ≤ 13 fallback
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, []);

  // Drag state lives in a ref so we never re-render during the gesture.
  const drag = useRef({
    isDown: false,
    didMove: false,
    startX: 0,
    startScrollLeft: 0,
    pointerId: 0,
    justDragged: false,
  });

  // Sustained-hover timer for the popup
  const hoverTimerRef = useRef<number | null>(null);

  // Scroll to the most recent era on mount
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollLeft = el.scrollWidth;
    });
  }, []);

  // Pre-fetch each era page so navigation is instant after a click
  useEffect(() => {
    ERAS.forEach((e) => router.prefetch(`/era/${e.id}`));
  }, [router]);

  // Close the popup on ESC
  useEffect(() => {
    if (!popupEra) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopupEra(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [popupEra]);

  // Lock body scroll when popup is open
  useEffect(() => {
    if (popupEra) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [popupEra]);

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
  }, []);

  const onCardHoverStart = useCallback(
    (era: Era) => {
      setHovered(era.id);
      clearHoverTimer();
      hoverTimerRef.current = window.setTimeout(() => {
        // Only open if nothing else has taken over (drag, click)
        if (!drag.current.isDown && !drag.current.didMove) {
          setPopupEra(era);
        }
      }, 1500);
    },
    [clearHoverTimer]
  );

  const onCardHoverEnd = useCallback(() => {
    setHovered(null);
    clearHoverTimer();
  }, [clearHoverTimer]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    drag.current.isDown = true;
    drag.current.didMove = false;
    drag.current.startX = e.clientX;
    drag.current.startScrollLeft = el.scrollLeft;
    drag.current.pointerId = e.pointerId;
    // Cancel any pending hover popup when the user starts interacting
    clearHoverTimer();
    // NOTE: We do NOT call setPointerCapture here, otherwise click events
    // would be retargeted to the container and card-level delegation would
    // still work but whileTap/Framer animations would glitch. Instead we rely
    // on React's event bubbling: since the listener is on the container,
    // pointermove events from child cards bubble up naturally.
  }, [clearHoverTimer]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.isDown) return;
    const el = containerRef.current;
    if (!el) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 8) {
      if (!drag.current.didMove) {
        drag.current.didMove = true;
        // Now that we're really dragging, capture the pointer so events don't
        // get lost when the cursor leaves the container bounds.
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
      el.scrollLeft = drag.current.startScrollLeft - dx;
    }
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (el && el.hasPointerCapture?.(e.pointerId)) {
      try {
        el.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
    drag.current.isDown = false;
    if (drag.current.didMove) {
      drag.current.justDragged = true;
      window.setTimeout(() => {
        drag.current.justDragged = false;
        drag.current.didMove = false;
      }, 80);
    } else {
      drag.current.didMove = false;
    }
  }, []);

  // Click delegation: find the closest data-era-id ancestor and navigate
  // (mode="navigate") OR fire the filter callback (mode="filter").
  // Re-clicking the active card in filter mode clears the filter.
  const onContainerClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (drag.current.justDragged || drag.current.didMove) return;
      const target = e.target as HTMLElement;
      const card = target.closest<HTMLElement>("[data-era-id]");
      if (!card) return;
      const eraId = card.dataset.eraId;
      if (!eraId) return;
      if (mode === "filter") {
        if (!onEraSelect) return;
        // Toggle : clicking the active card again clears the filter.
        const next = selectedEraId === eraId ? null : eraId;
        onEraSelect(next);
      } else {
        router.push(`/era/${eraId}`);
      }
    },
    [router, mode, selectedEraId, onEraSelect],
  );

  // Keyboard navigation. ArrowLeft/Right scroll the strip horizontally
  // (and in filter mode, also cycle the active era). Enter / Space on a
  // focused card triggers the same action as a click. Escape clears the
  // filter when one is active.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const el = containerRef.current;
      if (!el) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (mode === "filter" && onEraSelect) {
          // Cycle to the next era. If nothing is selected yet, pick the
          // first one. Wrap around at the end so keyboard users can scan
          // the whole strip without losing focus.
          const idx = selectedEraId
            ? ERAS.findIndex((e2) => e2.id === selectedEraId)
            : -1;
          const nextIdx = (idx + 1) % ERAS.length;
          onEraSelect(ERAS[nextIdx].id);
        }
        el.scrollBy({ left: 280, behavior: "smooth" });
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (mode === "filter" && onEraSelect) {
          const idx = selectedEraId
            ? ERAS.findIndex((e2) => e2.id === selectedEraId)
            : ERAS.length;
          const prevIdx = (idx - 1 + ERAS.length) % ERAS.length;
          onEraSelect(ERAS[prevIdx].id);
        }
        el.scrollBy({ left: -280, behavior: "smooth" });
      } else if (mode === "filter" && (e.key === "Escape") && selectedEraId && onEraSelect) {
        e.preventDefault();
        onEraSelect(null);
      }
    },
    [mode, selectedEraId, onEraSelect],
  );

  // Mouse wheel → horizontal scroll
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > 0) return;
      if (!e.deltaY) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <>
      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={onContainerClick}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="region"
        aria-label="Frise des epoques Karmine Corp"
        className="timeline-container relative flex items-center pb-10 pt-20 px-4 min-h-[640px] overflow-x-auto overflow-y-visible cursor-grab active:cursor-grabbing select-none focus:outline-none"
        style={{
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          touchAction: "pan-x",
        }}
      >
        <style>{`.timeline-container::-webkit-scrollbar { display: none; }`}</style>

        {ERAS.map((era: Era, i: number) => {
          const isHovered = hovered === era.id;
          const anyHovered = hovered !== null;
          const isDimmed = anyHovered && !isHovered;
          const isLive = era.id === "lec-2026-spring";
          // Filter-mode selection state. A card is "active" when it IS
          // the selectedEra ; "filter-dimmed" when the timeline is in
          // filter mode AND a different era is active.
          const isActiveFilter = mode === "filter" && selectedEraId === era.id;
          const isFilterDimmed =
            mode === "filter" && selectedEraId !== null && selectedEraId !== era.id;

          const baseOffset = -120;
          const rotation = (i - ERAS.length / 2) * 1.6;
          // Selected era pops above all others so its halo / accents
          // are not clipped by neighbour cards that overlap via -120 mL.
          const hoverZ = isActiveFilter
            ? 60
            : isHovered
            ? 50
            : 10 - Math.abs(i - ERAS.length / 2);

          // Per CLAUDE.md §6.2 : non-selected eras get
          // `filter: grayscale(100%) brightness(0.4)` — legible enough
          // to stay clickable, dimmed enough to make the active era
          // visually dominate. Active era scales 1.05 (additive on top
          // of the existing hover 1.08).
          const filterCss = isFilterDimmed
            ? "grayscale(100%) brightness(0.4)"
            : "none";
          // prefers-reduced-motion : cut the spring and snap the
          // grayscale/scale instantly. The opacity dim still applies —
          // it's essentially free and doesn't count as motion.
          const targetScale = isActiveFilter
            ? 1.05
            : isHovered
            ? 1.08
            : anyHovered
            ? 0.94
            : 1;
          const cardTransition = reducedMotion
            ? { duration: 0 }
            : ({ type: "spring" as const, stiffness: 220, damping: 22 });

          return (
            <m.div
              key={era.id}
              data-era-id={era.id}
              onMouseEnter={() => onCardHoverStart(era)}
              onMouseLeave={onCardHoverEnd}
              role="button"
              tabIndex={-1}
              aria-label={
                mode === "filter"
                  ? `Filtrer par ${era.label}`
                  : `${era.label} \u2014 ${era.period}`
              }
              aria-pressed={mode === "filter" ? isActiveFilter : undefined}
              whileTap={reducedMotion ? undefined : { scale: 0.97 }}
              animate={{
                scale: targetScale,
                y: isHovered || isActiveFilter ? -18 : 0,
                rotate: isHovered || isActiveFilter ? 0 : rotation,
                // NOTE: removed `filter: blur(1px)` from the dimmed state —
                // CSS blur is GPU-expensive and with 16 cards animating in
                // parallel on hover changes, it was causing a visible freeze
                // even on fast PCs. Using opacity instead is virtually free.
                opacity: isDimmed ? 0.35 : 1,
                filter: filterCss,
                zIndex: hoverZ,
              }}
              transition={cardTransition}
              className="era-card relative overflow-hidden rounded-2xl border-2 flex-shrink-0 cursor-pointer"
              style={{
                borderColor: isActiveFilter || isHovered ? era.color : "var(--border-gold)",
                boxShadow:
                  isActiveFilter
                    ? `0 30px 100px ${era.color}70, 0 0 80px ${era.color}50, inset 0 0 0 2px ${era.color}80`
                    : isHovered
                    ? `0 30px 80px ${era.color}50, 0 0 60px ${era.color}30, inset 0 0 0 1px ${era.color}40`
                    : "0 8px 20px rgba(0,0,0,0.6)",
                width: "320px",
                height: "460px",
                marginLeft: i === 0 ? 0 : `${baseOffset}px`,
                transformOrigin: "center center",
                // GPU hint so the browser upgrades the card to its own compositing
                // layer — dramatically cheaper than re-painting on every frame.
                willChange: "transform, opacity, filter",
                backfaceVisibility: "hidden",
              }}
            >
              {era.image && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <m.img
                    src={era.image}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover pointer-events-none"
                    draggable={false}
                    animate={{
                      scale: isHovered ? 1.15 : 1.05,
                      opacity: isHovered ? 1 : 0.75,
                    }}
                    transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-black/70 to-black/20 pointer-events-none" />
                  <m.div
                    className="absolute inset-0 pointer-events-none"
                    style={{
                      background: `linear-gradient(135deg, ${era.color}30 0%, transparent 40%, transparent 100%)`,
                    }}
                    animate={{ opacity: isHovered ? 1 : 0 }}
                  />
                </>
              )}
              {!era.image && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: `linear-gradient(135deg, ${era.color}40, #010A13)`,
                  }}
                />
              )}

              <m.div
                className="absolute top-0 left-0 h-[4px] pointer-events-none"
                style={{
                  backgroundColor: era.color,
                  boxShadow: `0 0 15px ${era.color}`,
                }}
                initial={{ width: "30%" }}
                animate={{ width: isHovered ? "100%" : "30%" }}
                transition={{ duration: 0.5 }}
              />

              <m.div
                className="absolute left-0 top-0 w-[3px] pointer-events-none"
                style={{ backgroundColor: era.color }}
                initial={{ height: "0%" }}
                animate={{ height: isHovered ? "100%" : "20%" }}
                transition={{ duration: 0.5, delay: 0.1 }}
              />

              {isLive && (
                <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-[var(--red)] px-3 py-1 shadow-xl pointer-events-none">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute h-full w-full rounded-full bg-white opacity-75" />
                    <span className="relative rounded-full h-2 w-2 bg-white" />
                  </span>
                  <span className="text-[10px] font-black text-white tracking-widest">LIVE</span>
                </div>
              )}

              <div className="absolute top-5 left-5 z-10 pointer-events-none">
                <div
                  className="rounded-md px-3 py-1 backdrop-blur-sm border"
                  style={{
                    backgroundColor: `${era.color}20`,
                    borderColor: `${era.color}50`,
                  }}
                >
                  <span
                    className="font-data text-[11px] font-bold tracking-widest uppercase"
                    style={{ color: era.color }}
                  >
                    {era.period}
                  </span>
                </div>
              </div>

              <div className="absolute top-5 right-5 z-10 pointer-events-none">
                <span className="rounded-full bg-black/50 backdrop-blur-sm border border-white/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/70">
                  {era.phase}
                </span>
              </div>

              <div className="absolute bottom-0 left-0 right-0 p-6 z-10 pointer-events-none">
                <m.div
                  className="text-6xl mb-3"
                  animate={{
                    scale: isHovered ? 1.2 : 1,
                    rotate: isHovered ? -5 : 0,
                  }}
                  transition={{ type: "spring", stiffness: 200 }}
                >
                  {era.icon}
                </m.div>
                <m.h3
                  className="font-display font-black leading-tight mb-2"
                  style={{
                    fontSize: "2.25rem",
                    textShadow: `0 2px 20px rgba(0,0,0,0.8), 0 0 30px ${era.color}30`,
                  }}
                  animate={{ y: isHovered ? -4 : 0 }}
                >
                  {era.label}
                </m.h3>
                <m.p
                  className="text-sm text-white/70 font-medium mb-3"
                  animate={{ y: isHovered ? -4 : 0 }}
                >
                  {era.subtitle}
                </m.p>
                <m.div
                  className="inline-block px-3 py-1.5 rounded-lg font-bold text-xs"
                  style={{
                    backgroundColor: `${era.color}20`,
                    border: `1px solid ${era.color}60`,
                    color: era.color,
                  }}
                  animate={{ y: isHovered ? -4 : 0 }}
                >
                  {era.result}
                </m.div>

                <m.div
                  className="mt-4 flex items-center gap-2"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{
                    opacity: isHovered ? 1 : 0,
                    y: isHovered ? 0 : 10,
                  }}
                  transition={{ duration: 0.3 }}
                >
                  <span className="text-[10px] uppercase tracking-[0.2em] text-white/70">
                    D&eacute;couvrir l&apos;&eacute;poque
                  </span>
                  <m.svg
                    className="h-3 w-3 text-white/70"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    animate={{ x: isHovered ? [0, 4, 0] : 0 }}
                    transition={{ repeat: Infinity, duration: 1.2 }}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                  </m.svg>
                </m.div>
              </div>
            </m.div>
          );
        })}
      </div>

      {/* ═══ HOVER-DELAY POPUP — sustained hover triggers a cinematic full-image lightbox ═══ */}
      <AnimatePresence>
        {popupEra && (
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-xl p-6"
            onClick={() => setPopupEra(null)}
          >
            <m.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="relative w-full max-w-6xl"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setPopupEra(null)}
                className="absolute -top-14 right-0 flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/60 text-white hover:bg-white/10 transition-colors"
                aria-label="Fermer"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Image frame with gold border + glow */}
              <div
                className="relative overflow-hidden rounded-2xl border-2"
                style={{
                  borderColor: popupEra.color,
                  boxShadow: `0 30px 120px ${popupEra.color}50, 0 0 80px ${popupEra.color}30, inset 0 0 0 1px ${popupEra.color}40`,
                  aspectRatio: "16 / 9",
                }}
              >
                {popupEra.image ? (
                  <Image
                    src={popupEra.image}
                    alt={popupEra.label}
                    fill
                    sizes="(max-width: 768px) 100vw, 800px"
                    className="object-cover"
                  />
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{
                      background: `linear-gradient(135deg, ${popupEra.color}40, #010A13)`,
                    }}
                  />
                )}

                {/* Accent gradient overlay */}
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    background: `linear-gradient(180deg, transparent 0%, transparent 50%, rgba(0,0,0,0.85) 100%)`,
                  }}
                />

                {/* Bottom caption */}
                <div className="absolute bottom-0 left-0 right-0 p-8 z-10">
                  <div className="flex items-center gap-3 mb-3">
                    <span
                      className="rounded-md px-3 py-1 font-data text-[11px] font-bold tracking-[0.2em] uppercase backdrop-blur-sm border"
                      style={{
                        color: popupEra.color,
                        backgroundColor: `${popupEra.color}20`,
                        borderColor: `${popupEra.color}50`,
                      }}
                    >
                      {popupEra.period}
                    </span>
                    <span className="font-data text-[10px] uppercase tracking-[0.25em] text-white/50">
                      {popupEra.phase}
                    </span>
                  </div>
                  <h2
                    className="font-display font-black text-5xl md:text-7xl leading-none"
                    style={{
                      color: popupEra.color,
                      textShadow: `0 0 40px ${popupEra.color}40, 0 4px 20px rgba(0,0,0,0.8)`,
                    }}
                  >
                    {popupEra.label}
                  </h2>
                  <p className="font-display text-lg md:text-2xl text-white/80 mt-2 font-bold">
                    {popupEra.subtitle}
                  </p>
                </div>
              </div>

              {/* CTA to open the full era page */}
              <div className="mt-6 flex items-center justify-between">
                <p className="text-xs text-white/40 uppercase tracking-[0.2em]">
                  Esc ou clic en dehors pour fermer
                </p>
                <button
                  onClick={() => {
                    const id = popupEra.id;
                    setPopupEra(null);
                    router.push(`/era/${id}`);
                  }}
                  className="inline-flex items-center gap-3 rounded-xl border px-6 py-3 font-display text-sm font-bold uppercase tracking-widest transition-all hover:scale-105"
                  style={{
                    color: popupEra.color,
                    borderColor: `${popupEra.color}60`,
                    backgroundColor: `${popupEra.color}15`,
                  }}
                >
                  D&eacute;couvrir l&apos;&eacute;poque
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </m.div>
          </m.div>
        )}
      </AnimatePresence>
    </>
  );
}
