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

/** Half-life in days. After 7 days a video has half its peak score.
 *  Tightened from 14d (2026-05-09) — operator feedback was that the
 *  carousel skewed too iconic-historical, drowning out the "this
 *  week's uploads" the user actually came to see. */
const RECENCY_HALF_LIFE_DAYS = 7;
/**
 * Floor on the recency multiplier so historically important clips (the
 * Le Sacre voicecoms, the Rekkles pentakill) never collapse to zero —
 * they still surface as second-tier when no recent uploads exist.
 *
 * Lowered from 0.06 to 0.02 (2026-05-09) so 90+ day old content
 * doesn't compete with fresh uploads on view-count alone. The seed
 * list provides the safety net for slow content periods.
 */
const RECENCY_FLOOR = 0.02;
/**
 * Hard cut-off : RSS-sourced videos older than this are dropped from
 * ranking entirely. Seed videos (hand-curated bangers) bypass this gate
 * — they're always rankable. Without the cap, the recency floor can
 * keep stale RSS items hovering on the carousel for months.
 *
 * 60 days = "two months ago", a reasonable horizon for "what's hot
 * around KC right now". Bump up if the LEC offseason makes the
 * carousel feel empty.
 */
const RSS_HARD_CUTOFF_DAYS = 60;

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
 *
 * RSS-sourced videos older than RSS_HARD_CUTOFF_DAYS are removed BEFORE
 * scoring — the recency floor alone wasn't enough to keep stale uploads
 * out of the carousel during LEC off-season. Seed videos (channelId === ""
 * proxies) bypass the cutoff because they're hand-curated bangers ; the
 * carousel WANTS the Le Sacre voicecoms available even three months
 * after the win.
 */
export function rankAndCap(videos: YoutubeVideo[], cap = 14): ScoredVideo[] {
  const filtered = videos.filter((v) => {
    // Seed videos use empty-string channelId proxies — always rankable.
    if (!v.channel.channelId) return true;
    return ageDays(v.publishedAt) <= RSS_HARD_CUTOFF_DAYS;
  });
  const scored = filtered.map(scoreVideo);
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
