/**
 * Types du feed /scroll.
 *
 * Ils vivaient dans ScrollFeed.tsx, la premiere version du feed. Ce
 * composant n'etait plus monte nulle part depuis le passage a
 * ScrollFeedV2 — cinq fichiers ne l'importaient plus que pour ces
 * quatre types, ce qui gardait 1450 lignes de composant mort dans
 * l'arbre. Les types vivent ici, le composant a ete supprime.
 */

// ─── Feed item types (discriminated union) ─────────────────────────────
//
// Two kinds of items can appear in /scroll:
//   1. `aggregate` — legacy per-player-per-game stats from kc_matches.json.
//      No real clip, splash-art background + KDA card.
//   2. `video` — a real kill published by the worker pipeline. Has a real
//      MP4 on R2, a highlight score, and a Gemini AI description.
//
// During the transition period both coexist: videos rank first, aggregates
// fill the long tail so the feed always feels full.

export interface AggregateFeedItem {
  kind: "aggregate";
  id: string;
  kcPlayer: { name: string; champion: string; role: string; kills: number; deaths: number; assists: number; gold: number; cs: number; level: number };
  oppPlayer: { name: string; champion: string; role: string; kills: number; deaths: number; assists: number; gold: number; cs: number; level: number } | null;
  match: { id: string; date: string; stage: string; opponent: { code: string; name: string }; kc_won: boolean };
  game: { number: number; kc_kills: number; opp_kills: number };
  isKcKiller: boolean;
  score: number;
  multiKill: string | null;
}

export interface VideoFeedItem {
  kind: "video";
  id: string;
  score: number;
  killerPlayerId: string | null;
  killerChampion: string;
  victimChampion: string;
  /** Player IGNs resolved server-side from kc_matches.json + roster
   *  for the active match. Null when not resolvable (data legacy /
   *  opponent player not in our roster mapping). When KC is the killer,
   *  killerName is one of {Canna, Yike, Kyeahoo, Caliste, Busio}. */
  killerName: string | null;
  victimName: string | null;
  /** Grid pivot dimensions — enables the /scroll?axis=...&value=... filter. */
  minuteBucket: string | null;
  fightType: string | null;
  clipVertical: string;
  clipVerticalLow: string | null;
  clipHorizontal: string | null;
  /** HLS master playlist URL — null = not yet HLS-packaged. */
  hlsMasterUrl?: string | null;
  /** Versioned kill_assets manifest (migration 026). When present, the
   *  player pool prefers it over the legacy clip* fields. NULL on rows
   *  clipped before the migration ran. */
  assetsManifest?: import("./v2/FeedPlayerPool").PoolAssetsManifest | null;
  thumbnail: string | null;
  /** V42-V43 — analyser-derived best-frame offset (s) for poster
   *  + initial seek. NULL on rows analysed before the migration. */
  bestThumbnailSeconds?: number | null;
  highlightScore: number | null;
  avgRating: number | null;
  ratingCount: number;
  /** Approved-comment count for the kill, mirroring `kills.comment_count`
   *  (kept fresh by the `fn_update_comment_count` trigger). Wave 20.8 —
   *  was previously hardcoded to 0 in FeedSidebarV2 callers ; now wired
   *  end-to-end from the SQL row through the FeedItem prop. */
  commentCount: number;
  /** Legacy single-language field — keep populated for back-compat with
   *  any code path that hasn't migrated to the multi-lang variants. */
  aiDescription: string | null;
  /** PR14 multi-language descriptions, picked by <Description> via the
   *  active LangProvider (cookie + Accept-Language fallback). When NULL
   *  the picker falls back to aiDescription_fr → aiDescription. */
  aiDescriptionFr: string | null;
  aiDescriptionEn: string | null;
  aiDescriptionKo: string | null;
  aiDescriptionEs: string | null;
  aiTags: string[];
  multiKill: string | null;
  isFirstBlood: boolean;
  kcInvolvement: string | null; // 'team_killer' | 'team_victim' | null
  gameTimeSeconds: number;
  gameNumber: number;
  matchExternalId: string;
  matchStage: string;
  matchDate: string;
  opponentCode: string;
  kcWon: boolean | null;
  matchScore: string | null;
}

export interface MomentFeedItem {
  kind: "moment";
  id: string;
  score: number;
  classification: string; // solo_kill, skirmish, teamfight, ace, objective_fight
  killCount: number;
  blueKills: number;
  redKills: number;
  kcInvolvement: string; // kc_aggressor, kc_victim, kc_both
  goldSwing: number;
  clipVertical: string;
  clipVerticalLow: string | null;
  clipHorizontal: string | null;
  /** HLS master playlist URL (Phase 4). */
  hlsMasterUrl?: string | null;
  /** Versioned moments_assets manifest (future migration). NULL today
   *  on every moment — kept for type symmetry with VideoFeedItem so
   *  ScrollFeedV2 can build PoolItem from either branch. */
  assetsManifest?: import("./v2/FeedPlayerPool").PoolAssetsManifest | null;
  thumbnail: string | null;
  momentScore: number | null;
  avgRating: number | null;
  ratingCount: number;
  /** Approved-comment count for the moment. Same shape as VideoFeedItem
   *  for symmetry. Wave 20.8 — wired end-to-end from `moments.comment_count`. */
  commentCount: number;
  aiDescription: string | null;
  // Multi-lang variants — moments are NOT translated by the worker yet
  // (they aggregate kill descriptions). Kept for type symmetry with
  // VideoFeedItem so <Description> works on either branch.
  aiDescriptionFr: string | null;
  aiDescriptionEn: string | null;
  aiDescriptionKo: string | null;
  aiDescriptionEs: string | null;
  aiTags: string[];
  startTimeSeconds: number;
  endTimeSeconds: number;
}

export type FeedItem = AggregateFeedItem | VideoFeedItem | MomentFeedItem;
