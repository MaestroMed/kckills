/**
 * Seed videos — hand-curated KC bangers we always want available even if
 * the RSS pipeline returns nothing (channel IDs missing, network down,
 * cold deploy). The carousel merges these with live RSS results, dedupes
 * by videoId, then ranks the union.
 *
 * Editorial note: every entry here is a clip Mehdi has personally vouched
 * for as showcase-worthy. They're never auto-pruned. To rotate: edit this
 * file. (V2 will gain a backoffice editor — see the handoff.)
 */

import type { CuratedChannel } from "./youtube-channels";
import type { YoutubeVideo } from "./youtube-rss";

/** Synthetic channel for entries that pre-date / bypass the channel registry. */
const KC_OFFICIAL_PROXY: CuratedChannel = {
  channelId: "",
  name: "Karmine Corp",
  handle: "KarmineCorp",
  weight: 3.0,
  kind: "official",
  color: "#C8AA6E",
  tagline: "Cha\u00eene officielle",
};

const FAN_PROXY: CuratedChannel = {
  channelId: "",
  name: "Riot LEC",
  handle: "LEC",
  weight: 1.4,
  kind: "scene",
  color: "#7B8DB5",
  tagline: "Diffusion officielle LEC",
};

interface SeedEntry {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
  views: number | null;
  channel: CuratedChannel;
}

const SEED: SeedEntry[] = [
  {
    videoId: "pMSFp7wku5Y",
    title: "Vladi Viktor 10/1/7 \u2014 Game 3 MVP run",
    description: "Le Sacre LEC Winter 2025, Vladi MVP de la finale.",
    publishedAt: "2025-02-23T20:00:00Z",
    views: 380000,
    channel: KC_OFFICIAL_PROXY,
  },
  {
    videoId: "j9JlExfa9mY",
    title: "REKKLES PENTAKILL JINX vs GameWard",
    description: "L'\u00e8re Rekkles \u2014 LFL Spring 2022.",
    publishedAt: "2022-04-08T18:00:00Z",
    views: 1200000,
    channel: KC_OFFICIAL_PROXY,
  },
  {
    videoId: "AelCWTFNOZQ",
    title: "\u00ab WE ARE THE CHAMPIONS ! \u00bb \u2014 KC VoiceComms",
    description: "Le Sacre, voicecoms backstage de la finale LEC Winter 2025.",
    publishedAt: "2025-02-26T18:00:00Z",
    views: 520000,
    channel: KC_OFFICIAL_PROXY,
  },
  {
    videoId: "VXdc0Q2HdCg",
    title: "Le discours de Kameto apr\u00e8s la finale LEC Winter 2025",
    description: "Post-match Le Sacre.",
    publishedAt: "2025-02-23T22:00:00Z",
    views: 450000,
    channel: KC_OFFICIAL_PROXY,
  },
  {
    videoId: "8AJP6HleZh8",
    title: "KC vs CFO \u2014 Un match dans la l\u00e9gende",
    description: "First Stand Seoul 2025, l'\u00e9preuve internationale.",
    publishedAt: "2025-03-15T14:00:00Z",
    views: 220000,
    channel: KC_OFFICIAL_PROXY,
  },
  {
    videoId: "EfN64vP2n2o",
    title: "Top 10 Caliste Plays \u2014 Best of 2025",
    description: "Caliste Rookie of the Year 2025, compilation.",
    publishedAt: "2025-09-12T16:00:00Z",
    views: 95000,
    channel: KC_OFFICIAL_PROXY,
  },
  {
    videoId: "bqBVNEm52A0",
    title: "Le Sacre \u2014 Trailer Karmine Corp Champions LEC",
    description: "L'histoire d'une ann\u00e9e, condens\u00e9e en 3 minutes.",
    publishedAt: "2025-02-24T12:00:00Z",
    views: 680000,
    channel: KC_OFFICIAL_PROXY,
  },
  {
    videoId: "cTs8IKYW5lI",
    title: "Karmine Corp Triple EU Masters \u2014 La l\u00e9gende",
    description: "L'\u00e9p\u00e9e tripl\u00e9e \u2014 LFL EU Masters 2021-2022.",
    publishedAt: "2022-05-10T18:00:00Z",
    views: 850000,
    channel: KC_OFFICIAL_PROXY,
  },
  {
    videoId: "tQCYNY2nbPY",
    title: "KC remporte les EU Masters 2021 Spring \u2014 Highlights",
    description: "Le premier titre majeur de l'histoire KC.",
    publishedAt: "2021-05-08T20:00:00Z",
    views: 540000,
    channel: KC_OFFICIAL_PROXY,
  },
  {
    videoId: "a953ZreZp8A",
    title: "Best plays LEC Winter 2025 \u2014 Karmine Corp",
    description: "Compilation des meilleurs plays KC du split.",
    publishedAt: "2025-02-28T10:00:00Z",
    views: 180000,
    channel: FAN_PROXY,
  },
];

/**
 * Returns seed entries dressed up as YoutubeVideo so the rest of the
 * pipeline is type-stable.
 */
export function getSeedVideos(): YoutubeVideo[] {
  return SEED.map((s) => ({
    videoId: s.videoId,
    title: s.title,
    description: s.description,
    publishedAt: s.publishedAt,
    thumbnailUrl: `https://i.ytimg.com/vi/${s.videoId}/hqdefault.jpg`,
    views: s.views,
    channel: s.channel,
  }));
}
