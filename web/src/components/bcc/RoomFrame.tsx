"use client";

/**
 * RoomFrame — visual shell for each of the cave's six rooms.
 *
 * Each room gets :
 *   • a tarnished brass plate at the top, engraved with the room title
 *   • a sub-line in italic Cormorant (the joke / mood)
 *   • a mahogany panel with brass corner ornaments for the body
 *   • a roman numeral on the brass plate (I-VI)
 *
 * The roman numeral is a load-bearing identity cue : the cave is laid out
 * vertically and the user scrolls through the rooms in order. Numbering
 * frames it as a TOUR rather than a dashboard.
 */

import type { ReactNode } from "react";
import { m, useReducedMotion } from "motion/react";

interface RoomFrameProps {
  numeral: "I" | "II" | "III" | "IV" | "V" | "VI";
  title: string;
  tagline: string;
  children: ReactNode;
  /** Optional override for the panel surface ("wood" default, "velvet"
   *  swaps in the burgundy damask). */
  surface?: "wood" | "velvet";
  /** Reveal delay in seconds (rooms appear with a stagger as the user
   *  scrolls — this is in addition to the cave-level fade-in). */
  revealDelay?: number;
}

export function RoomFrame({
  numeral,
  title,
  tagline,
  children,
  surface = "wood",
  revealDelay = 0,
}: RoomFrameProps) {
  const reduced = useReducedMotion();

  return (
    <section className="relative" aria-labelledby={`antre-room-${numeral}-title`}>
      {/* Header — brass plate + tagline */}
      <m.header
        className="text-center mb-6"
        initial={reduced ? false : { y: -10, opacity: 0 }}
        whileInView={reduced ? undefined : { y: 0, opacity: 1 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.7, delay: revealDelay, ease: [0.16, 1, 0.3, 1] }}
      >
        <span
          className="antre-brass-plate inline-block"
          style={{ fontSize: "clamp(13px, 2.4vw, 16px)" }}
        >
          <span style={{ opacity: 0.85, marginRight: "0.7em" }}>{numeral}.</span>
          <span id={`antre-room-${numeral}-title`}>{title}</span>
        </span>
        <p
          className="mt-4 mx-auto max-w-2xl antre-quill"
          style={{
            color: "rgba(232, 178, 90, 0.78)",
            fontSize: "clamp(14px, 1.8vw, 17px)",
            letterSpacing: "0.02em",
          }}
        >
          {tagline}
        </p>
      </m.header>

      {/* Body — mahogany panel with brass corners */}
      <m.div
        className={`antre-brass-corners ${surface === "velvet" ? "antre-panel-velvet" : "antre-panel"}`}
        initial={reduced ? false : { y: 24, opacity: 0 }}
        whileInView={reduced ? undefined : { y: 0, opacity: 1 }}
        viewport={{ once: true, amount: 0.15 }}
        transition={{ duration: 0.9, delay: revealDelay + 0.1, ease: [0.16, 1, 0.3, 1] }}
        style={{ padding: "clamp(20px, 3vw, 36px)" }}
      >
        {children}
      </m.div>
    </section>
  );
}
