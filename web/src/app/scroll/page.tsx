/**
 * /scroll — TikTok-native kill feed.
 *
 * This is the main scroll route as of Phase 7 swap (2026-04-20):
 *   - 5-element video player pool with portal-based teleport
 *   - Gesture-driven snap (framer-motion springs + use-gesture)
 *   - Network-aware quality switching
 *   - HLS adaptive streaming (when hls_master_url present)
 *   - Pull-to-refresh, end-of-feed card, chip filters
 *   - Keyboard shortcuts (J/K/space/M/L/C)
 *   - BGM player (NCS / royalty-free tracks)
 *
 * Legacy v1 backed up at scroll/page-v1-backup.tsx for rollback.
 */

import { loadRealData } from "@/lib/real-data";
import { getPublishedKills } from "@/lib/supabase/kills";
import { getPublishedMoments } from "@/lib/supabase/moments";
import { getTrackedRoster } from "@/lib/supabase/players";
import {
  type FeedItem,
  type VideoFeedItem,
  type MomentFeedItem,
} from "@/components/scroll/ScrollFeed";
import { ScrollFeedV2 } from "@/components/scroll/v2/ScrollFeedV2";
import type { GridAxisId } from "@/lib/grid/axis-config";

const FILTERABLE_AXES: ReadonlySet<string> = new Set<GridAxisId>([
  "game_minute_bucket",
  "killer_player_id",
  "opponent_team_code",
  "fight_type",
]);

export const revalidate = 60;
export const metadata = {
  title: "Scroll — KCKILLS",
  description: "Scroll les kills KC comme sur TikTok. Vrais clips video des matchs LEC, generes automatiquement.",
  openGraph: {
    title: "KC Kills — Le TikTok des kills LoL",
    description: "Scroll, rate et partage chaque kill Karmine Corp de la LEC. Clips video autoplay + descriptions AI.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "KC Kills — Le TikTok des kills LoL",
    description: "Scroll les kills KC comme sur TikTok.",
  },
};

interface ScrollPageProps {
  searchParams?: Promise<{
    kill?: string | string[];
    axis?: string | string[];
    value?: string | string[];
    multi?: string | string[];
    fb?: string | string[];
    player?: string | string[];
    fight?: string | string[];
    side?: string | string[];
  }>;
}

function firstString(v: string | string[] | undefined): string | undefined {
  if (!v) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

export interface ScrollChipFilters {
  multiKillsOnly: boolean;
  firstBloodsOnly: boolean;
  player: string | null;
  fight: string | null;
  side: "kc" | "vs" | null;
}

export default async function ScrollV2Page({ searchParams }: ScrollPageProps) {
  const sp = (await searchParams) ?? {};
  const initialKillId = firstString(sp.kill);
  const rawAxis = firstString(sp.axis);
  const rawValue = firstString(sp.value);
  const filterAxis: GridAxisId | null =
    rawAxis && FILTERABLE_AXES.has(rawAxis) ? (rawAxis as GridAxisId) : null;
  const filterValue = rawValue ?? null;

  const isTrue = (v: string | undefined) => v === "1" || v === "true";
  const sideRaw = firstString(sp.side);
  const chipFilters: ScrollChipFilters = {
    multiKillsOnly: isTrue(firstString(sp.multi)),
    firstBloodsOnly: isTrue(firstString(sp.fb)),
    player: firstString(sp.player) ?? null,
    fight: firstString(sp.fight) ?? null,
    side: sideRaw === "kc" || sideRaw === "vs" ? sideRaw : null,
  };
  const hasChipFilter =
    chipFilters.multiKillsOnly ||
    chipFilters.firstBloodsOnly ||
    chipFilters.player !== null ||
    chipFilters.fight !== null ||
    chipFilters.side !== null;

  const [data, allKills, allMoments, roster] = await Promise.all([
    Promise.resolve(loadRealData()),
    getPublishedKills(500),
    getPublishedMoments(300),
    getTrackedRoster(),
  ]);

  const ROLE_FOR_IGN: Record<string, "TOP" | "JGL" | "MID" | "ADC" | "SUP"> = {
    Canna: "TOP",
    Yike: "JGL",
    Kyeahoo: "MID",
    Caliste: "ADC",
    Busio: "SUP",
  };
  const rosterChips = roster
    .filter((p) => ROLE_FOR_IGN[p.ign])
    .map((p) => ({ id: p.id, ign: p.ign, role: ROLE_FOR_IGN[p.ign] }));

  const supabaseKills = allKills.filter(
    (k) =>
      k.tracked_team_involvement === "team_killer" &&
      k.kill_visible === true &&
      !!k.clip_url_vertical &&
      !!k.thumbnail_url,
  );

  const videoItems: VideoFeedItem[] = supabaseKills.map((k) => {
    const matchMeta = k.games?.matches;
    const matchJson = data.matches.find((m) => m.id === (matchMeta?.external_id ?? ""));
    const opponentCode = matchJson?.opponent.code ?? "LEC";
    const kcWon = matchJson?.kc_won ?? null;
    const matchScore = matchJson ? `${matchJson.kc_score}-${matchJson.opp_score}` : null;
    const hl = (k.highlight_score ?? 5) / 10;
    const rt = k.rating_count > 0 ? (k.avg_rating ?? 0) / 5 : 0;
    const engagement =
      k.impression_count > 5
        ? Math.min(1, (k.rating_count + k.comment_count) / k.impression_count)
        : 0;
    let score = hl * 0.6 + rt * 0.3 + engagement * 0.1;
    if (k.multi_kill === "penta") score *= 2.0;
    else if (k.multi_kill === "quadra") score *= 1.5;
    else if (k.multi_kill === "triple") score *= 1.2;
    if (k.is_first_blood) score *= 1.15;
    if (k.tracked_team_involvement === "team_killer") score *= 2.0;
    else if (k.tracked_team_involvement === "team_victim") score *= 0.3;
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
      hlsMasterUrl: k.hls_master_url ?? null,
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

  const momentItems: MomentFeedItem[] = allMoments
    .filter(
      (m) => !!m.clip_url_vertical && !!m.thumbnail_url && m.kc_involvement !== "kc_none",
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
      score *= 15;
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
        hlsMasterUrl: m.hls_master_url ?? null,
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

  let filteredVideos = filterAxis && filterValue
    ? videoItems.filter((v) => videoMatchesFilter(v, filterAxis, filterValue))
    : videoItems;
  if (hasChipFilter) {
    filteredVideos = filteredVideos.filter((v) => videoMatchesChips(v, chipFilters));
  }
  const filteredMoments = hasChipFilter
    ? momentItems.filter((m) => momentMatchesChips(m, chipFilters))
    : momentItems;

  // Moments disabled — duplicate kills without adding value
  const allClips: FeedItem[] = [...filteredVideos];
  const items: FeedItem[] = initialKillId
    ? [...allClips].sort((a, b) => b.score - a.score)
    : weightedShuffle(allClips);
  const clipCount = items.length;

  return (
    <ScrollFeedV2
      items={items}
      videoCount={clipCount}
      initialKillId={initialKillId}
      chipFilters={chipFilters}
      rosterChips={rosterChips}
    />
  );
}

function videoMatchesFilter(v: VideoFeedItem, axis: GridAxisId, value: string): boolean {
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

function videoMatchesChips(v: VideoFeedItem, c: ScrollChipFilters): boolean {
  if (c.multiKillsOnly && !v.multiKill) return false;
  if (c.firstBloodsOnly && !v.isFirstBlood) return false;
  if (c.fight && v.fightType !== c.fight) return false;
  if (c.side === "kc" && v.kcInvolvement !== "team_killer") return false;
  if (c.side === "vs" && v.kcInvolvement !== "team_victim") return false;
  if (c.player && v.killerPlayerId !== c.player) return false;
  return true;
}

function momentMatchesChips(m: MomentFeedItem, c: ScrollChipFilters): boolean {
  if (c.multiKillsOnly) return false;
  if (c.firstBloodsOnly) return false;
  if (c.player) return false;
  if (c.fight) {
    if (c.fight === "teamfight_5v5" || c.fight === "teamfight_4v4") {
      if (m.classification !== "teamfight" && m.classification !== "ace") return false;
    } else if (c.fight === "solo_kill") {
      if (m.classification !== "solo_kill") return false;
    } else {
      return false;
    }
  }
  if (c.side === "kc" && m.kcInvolvement !== "kc_aggressor" && m.kcInvolvement !== "kc_both")
    return false;
  if (c.side === "vs" && m.kcInvolvement !== "kc_victim") return false;
  return true;
}

function weightedShuffle(items: FeedItem[]): FeedItem[] {
  if (items.length <= 2) return items;
  const maxScore = Math.max(1, ...items.map((i) => i.score));
  const jittered = items
    .map((item) => ({
      item,
      sortKey: item.score + Math.random() * maxScore * 1.5,
    }))
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((j) => j.item);
  const LOOKAHEAD = 6;
  const out: FeedItem[] = [];
  const remaining = [...jittered];
  while (remaining.length > 0) {
    const last1 = out[out.length - 1];
    const last2 = out[out.length - 2];
    const k1 = last1 ? clumpKey(last1) : null;
    const k2 = last2 ? clumpKey(last2) : null;
    let pickIndex = 0;
    if (k1 || k2) {
      for (let i = 0; i < Math.min(LOOKAHEAD, remaining.length); i++) {
        const ck = clumpKey(remaining[i]);
        if (ck !== k1 && ck !== k2) {
          pickIndex = i;
          break;
        }
      }
    }
    out.push(remaining.splice(pickIndex, 1)[0]);
  }
  return out;
}

function clumpKey(item: FeedItem): string {
  if (item.kind === "video") return `v:${item.killerPlayerId ?? "?"}|${item.killerChampion}`;
  if (item.kind === "moment") return `m:${item.classification}|${item.killCount}`;
  return `a:${item.kcPlayer.name}|${item.kcPlayer.champion}`;
}
