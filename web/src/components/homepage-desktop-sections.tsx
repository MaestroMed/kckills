"use client";

/**
 * homepage-desktop-sections.tsx — client wrapper that lazy-loads the
 * heavy desktop-only homepage sections via next/dynamic with ssr:false.
 *
 * Why this file exists
 * ────────────────────
 * Next.js 15 forbids `ssr: false` on `next/dynamic` calls inside SERVER
 * components. The homepage `app/page.tsx` is a server component (data
 * fetching for hero stats + clip count + match list happens server-side)
 * so the lazy imports cannot live there.
 *
 * The pattern : tiny client wrappers that own the dynamic import +
 * the DesktopOnly gate. The server page imports the wrapper like any
 * other component ; the wrapper handles the runtime mobile decision +
 * the chunk download.
 *
 * Net effect on the mobile bundle :
 *   * The 4 wrapped components' code is split into separate JS chunks
 *     (next/dynamic creates a route group per dynamic call).
 *   * On mobile, <DesktopOnly> returns null → next/dynamic NEVER fires
 *     the import → the chunks are never downloaded.
 *   * On desktop, <DesktopOnly> returns children → dynamic fires →
 *     chunk downloaded on demand → mounts after first paint.
 *
 * Mobile users save ~50 KB of JS that they used to ship and parse
 * for nothing. Desktop users see no change beyond a brief loading
 * placeholder while the chunk arrives (the `loading: () => null`
 * fallbacks are intentional — these sections are below the fold so
 * an empty space is fine until the carousel mounts).
 */

import dynamic from "next/dynamic";
import { DesktopOnly } from "./DesktopOnly";
import { type RosterPlayerStat } from "./HomeTopScorerCarousel";
import type { Era } from "@/lib/eras";
import type { EraRoster } from "@/lib/era-rosters";
import type { Quote } from "@/lib/quotes";

// ─── Dynamic imports (client-side only) ───────────────────────────

const HomeRosterEraCarouselLazy = dynamic(
  () => import("./HomeRosterEraCarousel").then((m) => m.HomeRosterEraCarousel),
  { ssr: false, loading: () => null },
);

const HomeTopScorerCarouselLazy = dynamic(
  () => import("./HomeTopScorerCarousel").then((m) => m.HomeTopScorerCarousel),
  { ssr: false, loading: () => null },
);

const HomeQuoteRotatorLazy = dynamic(
  () => import("./HomeQuoteRotator").then((m) => m.HomeQuoteRotator),
  { ssr: false, loading: () => null },
);

const EraComparisonChartLazy = dynamic(
  () => import("./EraComparison").then((m) => m.EraComparisonChart),
  { ssr: false, loading: () => null },
);

// ─── Public wrapper components ────────────────────────────────────

export function HomeRosterEraCarouselSection({
  rosters,
}: {
  rosters: EraRoster[];
}) {
  return (
    <DesktopOnly>
      <HomeRosterEraCarouselLazy rosters={rosters} />
    </DesktopOnly>
  );
}

export function HomeTopScorerCarouselSection({
  players,
  fallback,
}: {
  players: RosterPlayerStat[];
  fallback: React.ReactNode;
}) {
  return (
    <DesktopOnly fallback={fallback}>
      <HomeTopScorerCarouselLazy players={players} />
    </DesktopOnly>
  );
}

export function HomeQuoteRotatorSection({
  quotes,
}: {
  quotes: Quote[];
}) {
  return (
    <DesktopOnly>
      <section
        className="-mx-6 md:-mx-8 lg:-mx-12 my-8"
        style={{
          background:
            "linear-gradient(180deg, transparent, rgba(15,29,54,0.4) 30%, rgba(15,29,54,0.4) 70%, transparent)",
        }}
      >
        <HomeQuoteRotatorLazy quotes={quotes} />
      </section>
    </DesktopOnly>
  );
}

interface EraComparisonRow {
  era: string;
  period: string;
  matches: number;
  wins: number;
  losses: number;
  winRate: number;
  avgKcKills: number;
  avgOppKills: number;
}
export function EraComparisonChartSection({
  data,
}: {
  data: EraComparisonRow[];
}) {
  return (
    <DesktopOnly>
      <section>
        <div className="flex items-center gap-3 mb-6">
          <span className="h-px flex-1 bg-[var(--border-gold)]" />
          <span className="font-data text-[10px] uppercase tracking-[0.3em] font-bold text-[var(--gold)]">
            Evolution KC par ere
          </span>
          <span className="h-px flex-1 bg-[var(--border-gold)]" />
        </div>
        <EraComparisonChartLazy data={data} />
      </section>
    </DesktopOnly>
  );
}

// Re-export Era for downstream consumers
export type { Era };
