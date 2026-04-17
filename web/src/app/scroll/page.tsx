import { loadRealData } from "@/lib/real-data";
import { getPublishedKills } from "@/lib/supabase/kills";
import { getPublishedMoments } from "@/lib/supabase/moments";
import {
  ScrollFeed,
  type FeedItem,
  type VideoFeedItem,
  type MomentFeedItem,
} from "@/components/scroll/ScrollFeed";
import type { GridAxisId } from "@/lib/grid/axis-config";

/** Axes the grid can pass through via ?axis=...&value=.... */
const FILTERABLE_AXES: ReadonlySet<string> = new Set<GridAxisId>([
  "game_minute_bucket",
  "killer_player_id",
  "opponent_team_code",
  "fight_type",
]);

export const revalidate = 60;
export const metadata = {
  title: "Scroll \u2014 KCKILLS",
  description: "Scroll les kills KC comme sur TikTok. Vrais clips vid\u00e9o des matchs LEC, g\u00e9n\u00e9r\u00e9s automatiquement.",
  openGraph: {
    title: "KC Kills \u2014 Le TikTok des kills LoL",
    description: "Scroll, rate et partage chaque kill Karmine Corp de la LEC. Clips vid\u00e9o autoplay + descriptions AI.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "KC Kills \u2014 Le TikTok des kills LoL",
    description: "Scroll les kills KC comme sur TikTok.",
  },
};

interface ScrollPageProps {
  searchParams?: Promise<{
    kill?: string | string[];
    axis?: string | string[];
    value?: string | string[];
  }>;
}

function firstString(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export default async function ScrollPage({ searchParams }: ScrollPageProps) {
  const sp = (await searchParams) ?? {};
  const initialKillId = firstString(sp.kill);
  const rawAxis = firstString(sp.axis);
  const rawValue = firstString(sp.value);
  const filterAxis: GridAxisId | null =
    rawAxis && FILTERABLE_AXES.has(rawAxis) ? (rawAxis as GridAxisId) : null;
  const filterValue = rawValue ?? null;

  // ─── 1. Load all data sources in parallel ───────────────────────────
  const [data, allKills, allMoments] = await Promise.all([
    Promise.resolve(loadRealData()),
    getPublishedKills(500),
    getPublishedMoments(300),
  ]);
  // ONLY show KC kills with a real clip + thumbnail + kill confirmed visible.
  // Anything else is a broken/incomplete row that would dead-link the feed.
  const supabaseKills = allKills.filter(
    (k) =>
      k.tracked_team_involvement === "team_killer" &&
      k.kill_visible === true &&
      !!k.clip_url_vertical &&
      !!k.thumbnail_url,
  );

  // ─── 2. Build the Supabase video items (real clips) ────────────────
  const videoItems: VideoFeedItem[] = supabaseKills
    .map((k) => {
      const matchMeta = k.games?.matches;
      const matchJson = data.matches.find((m) => m.id === (matchMeta?.external_id ?? ""));
      const opponentCode = matchJson?.opponent.code ?? "LEC";
      const kcWon = matchJson?.kc_won ?? null;
      const matchScore = matchJson ? `${matchJson.kc_score}-${matchJson.opp_score}` : null;
      // Wilson-ish score: (0.6 × highlight/10) + (0.3 × rating/5) + (0.1 × engagement cap)
      const hl = (k.highlight_score ?? 5) / 10;
      const rt = k.rating_count > 0 ? (k.avg_rating ?? 0) / 5 : 0;
      const engagement = k.impression_count > 5
        ? Math.min(1, (k.rating_count + k.comment_count) / k.impression_count)
        : 0;
      let score = hl * 0.6 + rt * 0.3 + engagement * 0.1;
      if (k.multi_kill === "penta") score *= 2.0;
      else if (k.multi_kill === "quadra") score *= 1.5;
      else if (k.multi_kill === "triple") score *= 1.2;
      // KC kills are the hero content — deaths are context but shouldn't dominate the feed
      if (k.tracked_team_involvement === "team_killer") score *= 2.0;
      else if (k.tracked_team_involvement === "team_victim") score *= 0.3;
      // Boost video items so real clips always outrank aggregate items at equal base
      score *= 10;
      return {
        kind: "video" as const,
        id: k.id,
        score,
        killerPlayerId: k.killer_player_id,
        killerChampion: k.killer_champion ?? "?",
        victimChampion: k.victim_champion ?? "?",
        minuteBucket: k.game_minute_bucket,
        fightType: k.fight_type,
        clipVertical: k.clip_url_vertical ?? "",
        clipVerticalLow: k.clip_url_vertical_low ?? null,
        clipHorizontal: k.clip_url_horizontal ?? null,
        thumbnail: k.thumbnail_url ?? null,
        highlightScore: k.highlight_score ?? null,
        avgRating: k.avg_rating ?? null,
        ratingCount: k.rating_count,
        aiDescription: k.ai_description ?? null,
        aiTags: k.ai_tags ?? [],
        multiKill: k.multi_kill,
        isFirstBlood: k.is_first_blood,
        kcInvolvement: k.tracked_team_involvement,
        gameTimeSeconds: k.game_time_seconds ?? 0,
        gameNumber: k.games?.game_number ?? 1,
        matchExternalId: matchMeta?.external_id ?? "",
        matchStage: matchMeta?.stage ?? "LEC",
        matchDate: matchMeta?.scheduled_at ?? k.created_at,
        opponentCode,
        kcWon,
        matchScore,
      };
    });

  // ─── 3. Build moment items (grouped kills — new system) ──────────────
  // Same strict rule: real vertical clip AND thumbnail required.
  const momentItems: MomentFeedItem[] = allMoments
    .filter(
      (m) =>
        !!m.clip_url_vertical &&
        !!m.thumbnail_url &&
        m.kc_involvement !== "kc_none",
    )
    .map((m) => {
      const hl = (m.moment_score ?? 5) / 10;
      const rt = m.rating_count > 0 ? (m.avg_rating ?? 0) / 5 : 0;
      let score = hl * 0.7 + rt * 0.3;
      if (m.classification === "ace") score *= 2.0;
      else if (m.classification === "teamfight") score *= 1.5;
      else if (m.classification === "objective_fight") score *= 1.4;
      if (m.kc_involvement === "kc_aggressor") score *= 2.0;
      else if (m.kc_involvement === "kc_victim") score *= 0.3;
      score *= 15; // Moments rank above individual kills
      return {
        kind: "moment" as const,
        id: m.id,
        score,
        classification: m.classification,
        killCount: m.kill_count,
        blueKills: m.blue_kills,
        redKills: m.red_kills,
        kcInvolvement: m.kc_involvement,
        goldSwing: m.gold_swing,
        clipVertical: m.clip_url_vertical!,
        clipVerticalLow: m.clip_url_vertical_low,
        clipHorizontal: m.clip_url_horizontal,
        thumbnail: m.thumbnail_url,
        momentScore: m.moment_score,
        avgRating: m.avg_rating,
        ratingCount: m.rating_count,
        aiDescription: m.ai_description,
        aiTags: m.ai_tags ?? [],
        startTimeSeconds: m.start_time_seconds,
        endTimeSeconds: m.end_time_seconds,
      };
    });

  // ─── 4. Optional axis filter (grid → scroll zoom-in) ─────────────────
  // When the user taps a cell in the Scroll Vivant grid, we pass the Y
  // axis through as a filter so the vertical feed only contains the slice
  // they were looking at. Empty filter means "show everything".
  const filteredVideos = filterAxis && filterValue
    ? videoItems.filter((v) => videoMatchesFilter(v, filterAxis, filterValue))
    : videoItems;

  // ─── 5. Merge + weighted shuffle ─────────────────────────────────────
  // ONLY real clips — no more aggregate splash-art placeholders. If a row
  // doesn't have a verified clip + thumbnail, it doesn't enter the feed.
  const allClips: FeedItem[] = [
    ...momentItems,
    ...filteredVideos,
  ];

  // Weighted shuffle: score influences position but doesn't dictate it
  // — unless a specific kill was requested, in which case we sort by score.
  const items: FeedItem[] = initialKillId
    ? [...allClips].sort((a, b) => b.score - a.score)
    : weightedShuffle(allClips);

  const clipCount = items.length;
  return (
    <ScrollFeed
      items={items}
      videoCount={clipCount}
      initialKillId={initialKillId}
    />
  );
}

/** Returns true when the video item matches the grid axis/value pair. */
function videoMatchesFilter(
  v: VideoFeedItem,
  axis: GridAxisId,
  value: string,
): boolean {
  switch (axis) {
    case "game_minute_bucket":
      return v.minuteBucket === value;
    case "killer_player_id":
      return v.killerPlayerId === value;
    case "opponent_team_code":
      return v.opponentCode === value;
    case "fight_type":
      return v.fightType === value;
    default:
      return true;
  }
}

/** Weighted shuffle: items with higher scores tend to appear earlier,
 *  but with randomness so each page load feels different. */
function weightedShuffle<T extends { score: number }>(items: T[]): T[] {
  // Add random jitter proportional to score range
  const maxScore = Math.max(1, ...items.map((i) => i.score));
  const jittered = items.map((item) => ({
    item,
    sortKey: item.score + Math.random() * maxScore * 0.5,
  }));
  jittered.sort((a, b) => b.sortKey - a.sortKey);
  return jittered.map((j) => j.item);
}

// inferOpponent removed — lookup now inline in the map (includes kcWon)
