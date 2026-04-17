/**
 * Editorial scoring for the homepage YouTube showcase.
 *
 * Score blends four signals so the carousel surfaces clips that are both
 * recent AND popular AND from a high-trust channel:
 *
 *   final = recency_decay × channel_weight × log_views × kc_match_bonus
 *
 * No raw view counts are surfaced (they vary 100×) — we use log10 so a
 * 5K-view Karmine Life vlog can still beat a 500K Sheep Esports edit if
 * it dropped this morning.
 */

import type { YoutubeVideo } from "./youtube-rss";

export interface ScoredVideo extends YoutubeVideo {
  score: number;
  reasons: string[]; // human-readable score breakdown for tooltips/debug
}

/** Half-life in days. After 14 days a video has half its peak score. */
const RECENCY_HALF_LIFE_DAYS = 14;
/**
 * Floor on the recency multiplier so historically important clips (the
 * Le Sacre voicecoms, the Rekkles pentakill) never collapse to zero —
 * they still surface as second-tier when no recent uploads exist.
 */
const RECENCY_FLOOR = 0.06;

/** Words that hint a video is genuinely about KC, not just generic LEC. */
const KC_KEYWORDS = [
  "karmine",
  "kc ",
  "canna",
  "yike",
  "kyeahoo",
  "caliste",
  "busio",
  "rekkles",
  "vladi",
  "targamas",
  "cabochard",
  "saken",
  "hantera",
  "le sacre",
  "kcorp",
];

function ageDays(publishedIso: string): number {
  const t = Date.parse(publishedIso);
  if (Number.isNaN(t)) return 30; // unknown date → treat as moderately fresh
  return Math.max(0, (Date.now() - t) / (1000 * 60 * 60 * 24));
}

function recencyDecay(daysOld: number): number {
  if (daysOld <= 0) return 1;
  return Math.max(RECENCY_FLOOR, Math.pow(0.5, daysOld / RECENCY_HALF_LIFE_DAYS));
}

function logViews(v: number | null): number {
  if (!v || v <= 0) return 1; // unknown view count → neutral
  // log10(views) maps 100→2, 10K→4, 1M→6 — gentle, comparable to weight scale.
  return Math.log10(v + 1);
}

function kcMatchBonus(video: YoutubeVideo): { bonus: number; matched: string | null } {
  const haystack = `${video.title} ${video.description}`.toLowerCase();
  for (const kw of KC_KEYWORDS) {
    if (haystack.includes(kw)) {
      return { bonus: 1.6, matched: kw };
    }
  }
  return { bonus: 1.0, matched: null };
}

export function scoreVideo(video: YoutubeVideo): ScoredVideo {
  const days = ageDays(video.publishedAt);
  const recency = recencyDecay(days);
  const channel = video.channel.weight;
  const log = logViews(video.views);
  const kc = kcMatchBonus(video);

  const score = recency * channel * log * kc.bonus;

  const reasons: string[] = [
    `recency=${recency.toFixed(2)} (${Math.round(days)}d)`,
    `channel=${channel.toFixed(1)}`,
    `views=${video.views ?? "?"}`,
    `kc_match=${kc.matched ?? "no"}`,
  ];

  return { ...video, score, reasons };
}

/**
 * Score → sort → dedupe by videoId → cap. Videos with score 0 are dropped
 * so we never surface ancient links.
 */
export function rankAndCap(videos: YoutubeVideo[], cap = 14): ScoredVideo[] {
  const scored = videos.map(scoreVideo);
  scored.sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  const out: ScoredVideo[] = [];
  for (const v of scored) {
    if (seen.has(v.videoId)) continue;
    seen.add(v.videoId);
    out.push(v);
    if (out.length >= cap) break;
  }
  return out;
}
