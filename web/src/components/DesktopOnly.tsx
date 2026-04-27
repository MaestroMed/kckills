"use client";

/**
 * DesktopOnly — render children only on viewports ≥ 768 px.
 *
 * Used as a Tier 3 mobile crash mitigation : iOS Safari was killing
 * the homepage tab after ~2 s ("Un problème récurrent est survenu")
 * because the homepage renders a stack of heavy carousels + 3D
 * parallax + animated text + multiple framer-motion AnimatePresence
 * trees. Even after Tier 1 (wolf player off mobile) and Tier 2 (hero
 * video off mobile), the cumulative React tree weight + simultaneous
 * intervals + memory pressure kept tripping iOS Safari's per-page
 * memory limit.
 *
 * The fix : wrap the heaviest desktop-only sections in this component.
 * On mobile (matchMedia max-width: 767 px), returns `null` immediately
 * → the whole subtree never mounts, no useEffect, no intervals, no
 * memory cost. On desktop, renders children unchanged.
 *
 * SSR-safe : returns `null` on the server (no children rendered) AND
 * during the very first client render. The mobile/desktop decision
 * is made on mount via matchMedia, then the children either appear
 * or stay hidden. There's a brief flash on desktop (~50 ms) where
 * the section appears empty before mounting — accepted trade-off
 * for guaranteed mobile-safety + zero hydration mismatch.
 *
 * Why not just CSS `hidden md:block` ?
 *   * CSS hides visually but the React tree still mounts. All the
 *     useEffect / setInterval / iframe loaders / framer-motion
 *     animations still run. Memory cost is identical.
 *   * Returning `null` skips the entire subtree — no mount, no JS
 *     execution, no resource cost.
 *
 * Usage :
 *   <DesktopOnly>
 *     <HeavyCarouselWithIntervals />
 *   </DesktopOnly>
 *
 *   <DesktopOnly fallback={<MobileLightAlternative />}>
 *     <Heavy3DScene />
 *   </DesktopOnly>
 */

import { useEffect, useState, type ReactNode } from "react";

interface DesktopOnlyProps {
  children: ReactNode;
  /** Optional lightweight content shown on mobile instead of the heavy
   *  desktop subtree. Useful when you want a static "see this on
   *  desktop" placeholder rather than nothing at all. */
  fallback?: ReactNode;
  /** Override the breakpoint (default 768 px = Tailwind `md`). */
  breakpointPx?: number;
}

export function DesktopOnly({
  children,
  fallback = null,
  breakpointPx = 768,
}: DesktopOnlyProps) {
  // Default to `null` for SSR + first render so we don't ship the
  // children's HTML to mobile in the SSR shell either.
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(min-width: ${breakpointPx}px)`);
    setShouldRender(mq.matches);
    const handler = (e: MediaQueryListEvent) => setShouldRender(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [breakpointPx]);

  if (!shouldRender) return <>{fallback}</>;
  return <>{children}</>;
}
