"use client";

/**
 * PlayerChartsLazy — historical lazy-loading shim for the player charts.
 *
 * The original implementation wrapped each chart in next/dynamic({ ssr: false })
 * to defer loading the recharts dependency (~100 KB of D3 + chart code) until
 * the chart actually rendered.
 *
 * The 2026-04-28 revamp replaced recharts with hand-rolled SVG components
 * (~5 KB total, zero dependencies, GPU-composited CSS animations). Lazy
 * loading is no longer worthwhile — the charts now pay for themselves
 * within a few KB and SSR-safe markup means they're visible immediately.
 *
 * This file is kept as a pass-through re-export so existing call sites
 * (`/player/[slug]/page.tsx`) don't need to be touched. New code should
 * import directly from `@/components/PlayerCharts`.
 */

export {
  PlayerRadar,
  ChampionPerformanceChart,
  RecentFormChart,
} from "./PlayerCharts";
