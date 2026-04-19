import { loadRealData } from "@/lib/real-data";
import { getPublishedKills } from "@/lib/supabase/kills";
import { getPublishedMoments } from "@/lib/supabase/moments";
import { getTrackedRoster } from "@/lib/supabase/players";
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
    /** New chip filters — orthogonal to axis/value, can stack. */
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

/** Active-filter shape passed to <ScrollFeed> so the chip bar can paint
 *  itself and so the page knows what to filter server-side. */
export interface ScrollChipFilters {
  /** "1" / "true" → only show clips with multi_kill ≠ null. */
  multiKillsOnly: boolean;
  /** "1" / "true" → only show clips with is_first_blood === true. */
  firstBloodsOnly: boolean;
  /** Player IGN slug (case-insensitive match against killer name). */
  player: string | null;
  /** Fight type enum. */
  fight: string | null;
  /** "kc" or "vs" — restrict to KC kills or KC deaths. */
  side: "kc" | "vs" | null;
}

export default async function ScrollPage({ searchParams }: ScrollPageProps) {
  const sp = (await searchParams) ?? {};
  const initialKillId = firstString(sp.kill);
  const rawAxis = firstString(sp.axis);
  const rawValue = firstString(sp.value);
  const filterAxis: GridAxisId | null =
    rawAxis && FILTERABLE_AXES.has(rawAxis) ? (rawAxis as GridAxisId) : null;
  const filterValue = rawValue ?? null;

  // ─── Chip filters (composable, orthogonal to axis/value) ────────────
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

  // ─── 1. Load all data sources in parallel ───────────────────────────
  const [data, allKills, allMoments, roster] = await Promise.all([
    Promise.resolve(loadRealData()),
    getPublishedKills(500),
    getPublishedMoments(300),
    getTrackedRoster(),
  ]);

  // Roster chip definitions for the filter UI. Map our 5 starters to the
  // role labels the chip strip displays. Anyone whose ign isn't in the
  // current LEC roster gets dropped (alumni stay browseable via /alumni).
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
      // First bloods carry tempo signal — small but meaningful boost
      if (k.is_first_blood) score *= 1.15;
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

  // ─── 4. Optional axis filter (grid → scroll zoom-in) ─────────────────
  // When the user taps a cell in the Scroll Vivant grid, we pass the Y
  // axis through as a filter so the vertical feed only contains the slice
  // they were looking at. Empty filter means "show everything".
  let filteredVideos = filterAxis && filterValue
    ? videoItems.filter((v) => videoMatchesFilter(v, filterAxis, filterValue))
    : videoItems;

  // ─── 4b. Chip filters (composable) ───────────────────────────────────
  if (hasChipFilter) {
    filteredVideos = filteredVideos.filter((v) => videoMatchesChips(v, chipFilters));
  }
  // Moments don't have all the same dimensions — filter them with what we
  // can resolve, drop the ones that can't possibly match.
  const filteredMoments = hasChipFilter
    ? momentItems.filter((m) => momentMatchesChips(m, chipFilters))
    : momentItems;

  // ─── 5. Merge + weighted shuffle ─────────────────────────────────────
  // ONLY real clips — no more aggregate splash-art placeholders. If a row
  // doesn't have a verified clip + thumbnail, it doesn't enter the feed.
  // Moments disabled — they duplicate individual kills without adding
  // value (most are 1-kill "solo_kill" with no description). Re-enable
  // once moment clips have unique multi-kill compilations.
  const allClips: FeedItem[] = [
    // ...filteredMoments,
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
      chipFilters={chipFilters}
      rosterChips={rosterChips}
    />
  );
}

/** Composable chip-filter match for VideoFeedItem. */
function videoMatchesChips(v: VideoFeedItem, c: ScrollChipFilters): boolean {
  if (c.multiKillsOnly && !v.multiKill) return false;
  if (c.firstBloodsOnly && !v.isFirstBlood) return false;
  if (c.fight && v.fightType !== c.fight) return false;
  if (c.side === "kc" && v.kcInvolvement !== "team_killer") return false;
  if (c.side === "vs" && v.kcInvolvement !== "team_victim") return false;
  // Player filter: case-insensitive match against killer name (we don't
  // have killerPlayerName on the row yet, so use UUID as-is for the slug
  // case OR look at the player_id pattern). For now, accept the IGN in
  // the URL as long as it shows up in the killer_player_id resolution
  // table managed by getPlayerByIgn — we approximate by matching the
  // killer_player_id directly (the chip UI passes the UUID).
  if (c.player && v.killerPlayerId !== c.player) return false;
  return true;
}

/** Composable chip-filter match for MomentFeedItem. Moments don't expose
 *  per-killer info (yet), so player + fight chips drop them entirely
 *  rather than showing irrelevant fights. */
function momentMatchesChips(m: MomentFeedItem, c: ScrollChipFilters): boolean {
  if (c.multiKillsOnly) return false; // moments aren't tagged with multi-kill
  if (c.firstBloodsOnly) return false;
  if (c.player) return false;
  if (c.fight) {
    // Loose mapping: teamfight chip matches "teamfight" + "ace" classifications
    if (c.fight === "teamfight_5v5" || c.fight === "teamfight_4v4") {
      if (m.classification !== "teamfight" && m.classification !== "ace") return false;
    } else if (c.fight === "solo_kill") {
      if (m.classification !== "solo_kill") return false;
    } else {
      return false;
    }
  }
  if (c.side === "kc" && m.kcInvolvement !== "kc_aggressor" && m.kcInvolvement !== "kc_both") return false;
  if (c.side === "vs" && m.kcInvolvement !== "kc_victim") return false;
  return true;
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

/** Weighted shuffle with variety enforcement.
 *
 *  Two-pass algorithm:
 *  1. Score + random jitter → seed ranking (high-score items still get to
 *     the top, but with enough noise that each page load feels different).
 *  2. Greedy de-clumping pass: walk the seeded list and, if the next item
 *     shares a clump key (player + champion or moment classification) with
 *     either of the last two picks, look ahead up to LOOKAHEAD positions
 *     for a different one and swap it forward.
 *
 *  Net effect: pentakills and high-highlight clips still surface fast, but
 *  the user never gets 5 Caliste solo-kills in a row.
 */
function weightedShuffle(items: FeedItem[]): FeedItem[] {
  if (items.length <= 2) return items;

  // Pass 1 — score + STRONG jitter for real variety on each page load.
  // Old: jitter = 0.5× max score → same top kills every time.
  // New: jitter = 1.5× max score → high-score items still trend toward
  // the top but the exact order is genuinely different each load.
  const maxScore = Math.max(1, ...items.map((i) => i.score));
  const jittered = items
    .map((item) => ({
      item,
      sortKey: item.score + Math.random() * maxScore * 1.5,
    }))
    .sort((a, b) => b.sortKey - a.sortKey)
    .map((j) => j.item);

  // Pass 2 — variety enforcement via lookahead swap.
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

/** Returns a stable string key used for de-clumping. Items sharing a key
 *  shouldn't sit back-to-back in the feed. */
function clumpKey(item: FeedItem): string {
  if (item.kind === "video") {
    return `v:${item.killerPlayerId ?? "?"}|${item.killerChampion}`;
  }
  if (item.kind === "moment") {
    return `m:${item.classification}|${item.killCount}`;
  }
  // aggregate — fall back to player + champion combo
  return `a:${item.kcPlayer.name}|${item.kcPlayer.champion}`;
}

// inferOpponent removed — lookup now inline in the map (includes kcWon)
