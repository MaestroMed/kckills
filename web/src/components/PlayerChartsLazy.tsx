"use client";

/**
 * PlayerChartsLazy — code-split wrapper around PlayerCharts.tsx.
 *
 * Recharts pulls in ~100 kB of D3 + chart code that the player page used
 * to ship in its initial bundle (240 kB First Load — biggest route in
 * the app). The actual charts sit BELOW the fold on /player/[slug],
 * after the cube morph hero, the stat tiles, and the match history list.
 *
 * Wrapping each export in next/dynamic({ ssr: false }) defers the
 * recharts chunk until the chart actually renders. The page paints fast
 * with placeholder boxes; the chart content drops in when ready.
 *
 * Skeleton dimensions match the rendered chart aspect ratios so there's
 * no CLS when the real chart mounts.
 */

import dynamic from "next/dynamic";

const Skeleton = ({ height = 240 }: { height?: number }) => (
  <div
    className="w-full rounded-xl bg-[var(--bg-elevated)]/40 animate-pulse"
    style={{ height }}
  />
);

export const PlayerRadar = dynamic(
  () => import("./PlayerCharts").then((m) => m.PlayerRadar),
  { ssr: false, loading: () => <Skeleton height={280} /> },
);

export const ChampionPerformanceChart = dynamic(
  () => import("./PlayerCharts").then((m) => m.ChampionPerformanceChart),
  { ssr: false, loading: () => <Skeleton height={240} /> },
);

export const RecentFormChart = dynamic(
  () => import("./PlayerCharts").then((m) => m.RecentFormChart),
  { ssr: false, loading: () => <Skeleton height={180} /> },
);
