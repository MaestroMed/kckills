"use client";

/**
 * LiveBanner — fixed-top strip shown inside /scroll when KC is currently
 * playing a match. Distinct from the global `web/src/components/LiveBanner`
 * (used in the layout chrome): this one is specific to the scroll feed and
 * fires the in-feed "scroll to most recent kill" CTA on tap.
 *
 * Visuals :
 *   - Solid red (--red E84057) background, gold-outlined dot pulsing
 *   - Marquee-style scrolling text "KC EN LIVE • vs OPP • Game N"
 *   - 44px tall on mobile, 48px on desktop
 *   - Respects prefers-reduced-motion: marquee freezes, dot still pulses
 *     with a low-amplitude opacity tween (essentially still readable)
 *
 * Interaction :
 *   - Tap → scroll to the most recent kill (calls onTap with no args)
 *   - If onTap is omitted (no kills yet), falls back to a Link that
 *     navigates to /match/[external_id]
 *
 * Mounted ABOVE the scroll feed via React Portal so it escapes any
 * overflow:hidden parent (the ScrollFeedV2 root has overflow-hidden).
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";

interface Props {
  isLive: boolean;
  matchId?: string;
  opponentCode?: string;
  gameNumber?: number;
  /**
   * Tap handler — typically jumps the feed to the most recent kill.
   * If null, the banner renders a Link to /match/[matchId] instead.
   */
  onTap?: () => void;
}

export function LiveBanner({ isLive, matchId, opponentCode, gameNumber, onTap }: Props) {
  // Portal target — body. Need to wait for client mount because document is
  // undefined during SSR.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  const reducedMotion = useReducedMotion();

  if (!isLive || !portalTarget) return null;

  const opp = opponentCode ?? "?";
  const game = typeof gameNumber === "number" ? `Game ${gameNumber}` : "EN COURS";
  const label = `KC EN LIVE • vs ${opp} • ${game}`;
  // Repeat the label so the marquee loop doesn't show a visible gap.
  const marqueeText = `${label}     ★     ${label}     ★     `;

  const content = (
    <div
      className="flex items-center gap-2 overflow-hidden bg-[var(--red)] text-[var(--text-primary)] shadow-lg"
      style={{
        height: "44px",
        // Honour notches / dynamic island.
        paddingTop: "env(safe-area-inset-top, 0px)",
        boxSizing: "content-box",
      }}
    >
      {/* Pulsing dot — gold-outlined, always animating (the spec calls for
          it to remain even with prefers-reduced-motion). */}
      <div className="flex items-center pl-3 shrink-0">
        <motion.span
          className="block h-2.5 w-2.5 rounded-full bg-white"
          style={{ boxShadow: "0 0 0 2px rgba(200,170,110,0.6)" }}
          animate={
            reducedMotion
              ? { opacity: [1, 0.55, 1] }
              : { opacity: [1, 0.4, 1], scale: [1, 1.35, 1] }
          }
          transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
          aria-hidden
        />
      </div>

      {/* Marquee text — animated translation when reduced-motion is OFF;
          static label otherwise. The wrapper is overflow-hidden so the
          translated text disappears on the right side cleanly. */}
      <div className="relative flex-1 overflow-hidden whitespace-nowrap">
        {reducedMotion ? (
          <span className="font-display text-sm font-bold uppercase tracking-widest">
            {label}
          </span>
        ) : (
          <motion.span
            className="inline-block font-display text-sm font-bold uppercase tracking-widest"
            initial={{ x: "0%" }}
            animate={{ x: "-50%" }}
            transition={{
              duration: 18,
              repeat: Infinity,
              ease: "linear",
            }}
          >
            {/* Render the label twice inline so the -50% loop never shows a
                gap — when the first copy is fully off-screen left, the
                second copy is exactly aligned at the original 0%. */}
            <span>{marqueeText}</span>
            <span>{marqueeText}</span>
          </motion.span>
        )}
      </div>

      {/* Trailing chevron — affordance that the banner is tappable. */}
      <div className="pr-3 shrink-0">
        <svg className="h-4 w-4 text-white/85" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
      </div>
    </div>
  );

  // Wrapper handles the responsive height tweak (md:48px) + click handler.
  // `pointer-events-auto` cancels the parent's `pointer-events-none` if any.
  const ariaLabel = onTap
    ? "KC en live — voir le dernier kill"
    : matchId
      ? `KC en live vs ${opp} — voir le match`
      : "KC en live";

  const wrapperClass =
    "fixed left-0 right-0 top-0 z-[120] cursor-pointer pointer-events-auto md:[&_>div]:!h-[48px]";

  let banner;
  if (onTap) {
    banner = (
      <button
        type="button"
        onClick={onTap}
        className={`${wrapperClass} block w-full appearance-none border-0 bg-transparent p-0 text-left`}
        aria-label={ariaLabel}
      >
        {content}
      </button>
    );
  } else if (matchId) {
    banner = (
      <Link href={`/match/${encodeURIComponent(matchId)}`} className={wrapperClass} aria-label={ariaLabel}>
        {content}
      </Link>
    );
  } else {
    // No interaction target — render a plain div (still informative).
    banner = (
      <div className={wrapperClass} role="status" aria-label={ariaLabel}>
        {content}
      </div>
    );
  }

  return createPortal(banner, portalTarget);
}
