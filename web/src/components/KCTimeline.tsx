"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { ERAS, type Era } from "@/lib/eras";

/**
 * Horizontal scrolling timeline with robust drag-to-scroll + click-to-navigate.
 *
 * Uses the Pointer Events API with setPointerCapture so the drag works
 * consistently regardless of which card the pointer is over. Cards are
 * navigated via useRouter().push so we can cancel navigation when the
 * pointer moved during the gesture.
 *
 * Native horizontal overflow is also enabled, so users can scroll with:
 * - Mouse wheel (shift-scroll on Win, 2-finger swipe on Mac)
 * - Keyboard arrows (when focused)
 * - Touch swipe on mobile
 * - Click and drag
 */
export function KCTimeline() {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Drag state lives in a ref so we never re-render during the gesture.
  const drag = useRef({
    isDown: false,
    didMove: false,
    startX: 0,
    startScrollLeft: 0,
    pointerId: 0,
    justDragged: false,
  });

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

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only left mouse button (touch and pen also welcome)
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const el = containerRef.current;
    if (!el) return;
    drag.current.isDown = true;
    drag.current.didMove = false;
    drag.current.startX = e.clientX;
    drag.current.startScrollLeft = el.scrollLeft;
    drag.current.pointerId = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // setPointerCapture can throw if the browser withdraws capture; ignore
    }
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.isDown) return;
    const el = containerRef.current;
    if (!el) return;
    const dx = e.clientX - drag.current.startX;
    if (Math.abs(dx) > 8) drag.current.didMove = true;
    el.scrollLeft = drag.current.startScrollLeft - dx;
  }, []);

  const endDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (el && el.hasPointerCapture(e.pointerId)) {
      el.releasePointerCapture(e.pointerId);
    }
    drag.current.isDown = false;
    // Keep the "justDragged" flag on for a few ms so the click that follows
    // a drag on macOS/Chromium is cleanly swallowed by handleCardClick.
    if (drag.current.didMove) {
      drag.current.justDragged = true;
      window.setTimeout(() => {
        drag.current.justDragged = false;
      }, 80);
    }
  }, []);

  const handleCardClick = useCallback(
    (eraId: string) => (e: React.MouseEvent) => {
      if (drag.current.justDragged || drag.current.didMove) {
        e.preventDefault();
        return;
      }
      router.push(`/era/${eraId}`);
    },
    [router]
  );

  // Keyboard navigation: arrow left/right scrolls by one card
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = containerRef.current;
    if (!el) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      el.scrollBy({ left: 280, behavior: "smooth" });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      el.scrollBy({ left: -280, behavior: "smooth" });
    }
  }, []);

  // Mouse wheel → horizontal scroll (so classic vertical wheels work too)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      // Only remap pure vertical wheels; let trackpads/shift+wheel pass through
      if (Math.abs(e.deltaX) > 0) return;
      if (!e.deltaY) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
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
      {/* Hide native scrollbar (WebKit) */}
      <style>{`.timeline-container::-webkit-scrollbar { display: none; }`}</style>

      {ERAS.map((era: Era, i: number) => {
        const isHovered = hovered === era.id;
        const anyHovered = hovered !== null;
        const isDimmed = anyHovered && !isHovered;
        const isLive = era.id === "lec-2026-spring";

        const baseOffset = -120;
        const rotation = (i - ERAS.length / 2) * 1.6;
        const hoverZ = isHovered ? 50 : 10 - Math.abs(i - ERAS.length / 2);

        return (
          <motion.div
            key={era.id}
            onMouseEnter={() => setHovered(era.id)}
            onMouseLeave={() => setHovered(null)}
            onClick={handleCardClick(era.id)}
            role="button"
            tabIndex={-1}
            aria-label={`${era.label} \u2014 ${era.period}`}
            whileTap={{ scale: 0.97 }}
            animate={{
              scale: isHovered ? 1.08 : anyHovered ? 0.94 : 1,
              y: isHovered ? -18 : 0,
              rotate: isHovered ? 0 : rotation,
              filter: isDimmed ? "grayscale(80%) brightness(0.4) blur(1px)" : "none",
              zIndex: hoverZ,
            }}
            transition={{ type: "spring", stiffness: 220, damping: 22 }}
            className="era-card relative overflow-hidden rounded-2xl border-2 flex-shrink-0 cursor-pointer"
            style={{
              borderColor: isHovered ? era.color : "var(--border-gold)",
              boxShadow: isHovered
                ? `0 30px 80px ${era.color}50, 0 0 60px ${era.color}30, inset 0 0 0 1px ${era.color}40`
                : "0 8px 20px rgba(0,0,0,0.6)",
              width: "320px",
              height: "460px",
              marginLeft: i === 0 ? 0 : `${baseOffset}px`,
              transformOrigin: "center center",
            }}
          >
            {era.image && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <motion.img
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
                <motion.div
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

            {/* Top color bar */}
            <motion.div
              className="absolute top-0 left-0 h-[4px] pointer-events-none"
              style={{
                backgroundColor: era.color,
                boxShadow: `0 0 15px ${era.color}`,
              }}
              initial={{ width: "30%" }}
              animate={{ width: isHovered ? "100%" : "30%" }}
              transition={{ duration: 0.5 }}
            />

            {/* Side accent line */}
            <motion.div
              className="absolute left-0 top-0 w-[3px] pointer-events-none"
              style={{ backgroundColor: era.color }}
              initial={{ height: "0%" }}
              animate={{ height: isHovered ? "100%" : "20%" }}
              transition={{ duration: 0.5, delay: 0.1 }}
            />

            {/* LIVE badge */}
            {isLive && (
              <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-[var(--red)] px-3 py-1 shadow-xl pointer-events-none">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative rounded-full h-2 w-2 bg-white" />
                </span>
                <span className="text-[10px] font-black text-white tracking-widest">LIVE</span>
              </div>
            )}

            {/* Period badge top left */}
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

            {/* Phase chip */}
            <div className="absolute top-5 right-5 z-10 pointer-events-none">
              <span className="rounded-full bg-black/50 backdrop-blur-sm border border-white/20 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white/70">
                {era.phase}
              </span>
            </div>

            {/* Bottom content */}
            <div className="absolute bottom-0 left-0 right-0 p-6 z-10 pointer-events-none">
              <motion.div
                className="text-6xl mb-3"
                animate={{
                  scale: isHovered ? 1.2 : 1,
                  rotate: isHovered ? -5 : 0,
                }}
                transition={{ type: "spring", stiffness: 200 }}
              >
                {era.icon}
              </motion.div>
              <motion.h3
                className="font-display font-black leading-tight mb-2"
                style={{
                  fontSize: "2.25rem",
                  textShadow: `0 2px 20px rgba(0,0,0,0.8), 0 0 30px ${era.color}30`,
                }}
                animate={{ y: isHovered ? -4 : 0 }}
              >
                {era.label}
              </motion.h3>
              <motion.p
                className="text-sm text-white/70 font-medium mb-3"
                animate={{ y: isHovered ? -4 : 0 }}
              >
                {era.subtitle}
              </motion.p>
              <motion.div
                className="inline-block px-3 py-1.5 rounded-lg font-bold text-xs"
                style={{
                  backgroundColor: `${era.color}20`,
                  border: `1px solid ${era.color}60`,
                  color: era.color,
                }}
                animate={{ y: isHovered ? -4 : 0 }}
              >
                {era.result}
              </motion.div>

              <motion.div
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
                <motion.svg
                  className="h-3 w-3 text-white/70"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  animate={{ x: isHovered ? [0, 4, 0] : 0 }}
                  transition={{ repeat: Infinity, duration: 1.2 }}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M9 5l7 7-7 7" />
                </motion.svg>
              </motion.div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
