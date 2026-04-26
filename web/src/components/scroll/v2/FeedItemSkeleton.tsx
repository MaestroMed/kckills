"use client";

/**
 * FeedItemSkeleton — placeholder card shown between the last loaded
 * feed item and the next pre-fetch batch.
 *
 * Why a skeleton and not just the empty pool slot?
 *   - The pool's <video> elements only get bound for the visible window
 *     (live + warm + cold = 5 slots). Items further down stay as plain
 *     poster <Image> placeholders. When the user nears the end of the
 *     loaded batch and the parent triggers an infinite-fetch, there's
 *     a brief gap where neither poster nor pool slot is rendered. A
 *     shimmering skeleton bridges that gap so the feed never goes black.
 *
 *   - On slow networks (3G / Save-Data), the next page can take 800ms+
 *     to arrive. Without a skeleton the user sees a blank h-dvh screen,
 *     panics, and bounces. The shimmer signals "loading, hold on".
 *
 * Layout matches FeedItemVideo's footprint — same h-dvh poster area +
 * bottom-aligned title/description placeholders + score chip — so the
 * snap math (item N is at top = N * itemHeight) stays consistent.
 *
 * Animation: a gold-tinted gradient sweeps across the poster region
 * left → right every 1.6s. The sweep is driven by CSS keyframes (no
 * Framer Motion overhead — this fires multiple times per session).
 *
 * Accessibility:
 *   - aria-busy="true" on the wrapper so screen readers announce a load
 *   - "Chargement du clip suivant..." visually hidden text for SR users
 *   - prefers-reduced-motion: shimmer disabled, falls back to a static
 *     gradient with a subtle opacity hint
 */

interface Props {
  /** Pixel height of the slot — must match the parent's itemHeight to
   *  keep the snap-anchor math aligned with real FeedItems. */
  itemHeight: number;
}

export function FeedItemSkeleton({ itemHeight }: Props) {
  return (
    <div
      data-feed-skeleton
      role="status"
      aria-busy="true"
      aria-live="polite"
      style={{ height: `${itemHeight}px` }}
      className="relative w-full overflow-hidden bg-black"
    >
      {/* Visually hidden announcement for screen readers. */}
      <span className="sr-only">Chargement du clip suivant&hellip;</span>

      {/* Poster area — base dark surface with a faint hextech glow so the
          skeleton doesn't read as a broken black rectangle. */}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 50% 35%, rgba(200,170,110,0.06), transparent 65%), " +
            "linear-gradient(180deg, #0A1428 0%, #010A13 70%, #010A13 100%)",
        }}
      />

      {/* Shimmer sweep — a gold-tinted gradient band that translates from
          -100% to 100% over 1.6s. The motion-reduce variant disables the
          animation and leaves a static low-opacity strip. */}
      <div
        aria-hidden
        className="absolute inset-0 motion-safe:animate-[kc-feed-shimmer_1600ms_ease-in-out_infinite] motion-reduce:opacity-30"
        style={{
          background:
            "linear-gradient(105deg, transparent 35%, rgba(200,170,110,0.10) 50%, transparent 65%)",
          backgroundSize: "200% 100%",
          backgroundPosition: "-100% 0",
        }}
      />

      {/* Inline keyframes — kept here (not in globals) so the skeleton
          stays self-contained. The animation name is namespaced with kc-
          to avoid collisions with any future Tailwind-arbitrary anims. */}
      <style>{`
        @keyframes kc-feed-shimmer {
          0%   { background-position: -150% 0; }
          50%  { background-position: 100% 0; }
          100% { background-position: 250% 0; }
        }
      `}</style>

      {/* Bottom + top gradient — same as FeedItemVideo so the visual
          weight feels familiar. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0) 55%)," +
            "linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 18%)",
        }}
      />

      {/* Bottom overlay — placeholder bars matching the real FeedItem
          layout (badges row → matchup line → description → meta). */}
      <div
        className="absolute inset-x-0 bottom-0 z-10 pl-4 md:pl-7 lg:pl-10 pointer-events-none"
        style={{
          paddingBottom: "max(2rem, env(safe-area-inset-bottom, 2rem))",
          paddingRight: "calc(72px + env(safe-area-inset-right, 0px))",
        }}
      >
        <div className="space-y-3 max-w-2xl">
          {/* Badges row */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-5 w-20 rounded-md bg-white/10 motion-safe:animate-pulse" />
            <div className="h-5 w-16 rounded-md bg-white/10 motion-safe:animate-pulse" />
            <div className="h-5 w-12 rounded-md bg-[var(--gold)]/15 motion-safe:animate-pulse" />
          </div>
          {/* Players line */}
          <div className="h-3 w-48 rounded bg-white/10 motion-safe:animate-pulse" />
          {/* Matchup headline */}
          <div className="h-8 md:h-10 w-3/4 rounded bg-white/15 motion-safe:animate-pulse" />
          {/* Description (2 lines) */}
          <div className="space-y-2">
            <div className="h-3 w-5/6 rounded bg-white/10 motion-safe:animate-pulse" />
            <div className="h-3 w-2/3 rounded bg-white/10 motion-safe:animate-pulse" />
          </div>
          {/* Match meta */}
          <div className="h-2 w-32 rounded bg-white/10 motion-safe:animate-pulse" />
        </div>
      </div>

      {/* Right-rail placeholder — 4 stacked dots mirroring the action
          rail (like / comments / share / detail). Subtle so the eye
          doesn't expect interactivity on a skeleton. */}
      <div className="absolute right-3 md:right-5 lg:right-7 bottom-32 md:bottom-40 z-10 flex flex-col items-center gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-12 w-12 rounded-full bg-white/5 border border-white/10 motion-safe:animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
