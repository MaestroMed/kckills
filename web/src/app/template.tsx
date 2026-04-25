"use client";

import { m } from "motion/react";

/**
 * Route transition template — re-created on every page navigation.
 *
 * Provides a subtle fade + upward slide that gives the site a cinematic,
 * polished feel without being distracting. Duration is kept short (250ms)
 * so navigation feels instant but not jarring.
 *
 * The /scroll page uses `fixed inset-0` so it visually breaks out of this
 * wrapper and isn't affected by the animation.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        ease: [0.16, 1, 0.3, 1], // cubic-bezier for Hextech feel
      }}
    >
      {children}
    </m.div>
  );
}
