/**
 * Curated YouTube channels feeding the homepage parallax showcase.
 *
 * Each channel's last ~15 uploads are pulled from its public RSS feed
 * (`https://www.youtube.com/feeds/videos.xml?channel_id=<UC...>`). RSS is
 * unauthenticated, has zero quota, and ships title + thumbnail + publish
 * date out of the box.
 *
 * `weight` boosts a channel's videos in the scoring pass — the official
 * KC channel and Karmine Life carry KC-first content so they outrank
 * generic LEC reaction channels.
 *
 * To add a channel: paste the URL in the address bar of any YouTube channel
 * page. The path is `/@handle` — open the channel, view source, search for
 * `"channelId":"UC` to grab the real ID. Drop it below.
 *
 * If a channel ID is wrong / removed, the fetcher logs the failure and
 * silently skips it so the showcase still renders the other channels.
 */

export type ChannelKind =
  | "official"      // Karmine Corp's first-party output
  | "behind"        // Behind-the-scenes / Karmine Life-style content
  | "founder"       // Kameto / Prime / founders
  | "player"        // Active KC players' personal channels
  | "alumni"        // Alumni players' personal channels
  | "reaction"      // Caster / reaction / analysis channels
  | "scene";        // Broader LEC / French scene that regularly covers KC

export interface CuratedChannel {
  /** YouTube channel ID (`UC…`). Leave empty to disable until known. */
  channelId: string;
  /** Display name shown in the carousel pill. */
  name: string;
  /** Public handle (without leading `@`) for deep-links. */
  handle: string;
  /** Editorial weight — 0 (mute) to 3 (front-page). */
  weight: number;
  kind: ChannelKind;
  /** Optional accent colour for the badge tint. */
  color?: string;
  /** Short description shown on hover. */
  tagline?: string;
}

/**
 * Known KC ecosystem channels.
 *
 * NOTE: channelIds marked `""` need to be backfilled. The carousel will
 * still render — RSS for empty channels is skipped, and the seed videos
 * keep the section populated until the IDs are filled in.
 */
export const KC_YOUTUBE_CHANNELS: CuratedChannel[] = [
  {
    channelId: "",
    name: "Karmine Corp",
    handle: "KarmineCorp",
    weight: 3.0,
    kind: "official",
    color: "#C8AA6E",
    tagline: "Cha\u00eene officielle de la Karmine Corp",
  },
  {
    channelId: "",
    name: "Karmine Life",
    handle: "KarmineLife",
    weight: 2.5,
    kind: "behind",
    color: "#0AC8B9",
    tagline: "Behind-the-scenes des joueurs",
  },
  {
    channelId: "",
    name: "Kameto",
    handle: "kameto",
    weight: 2.0,
    kind: "founder",
    color: "#0057FF",
    tagline: "Le pr\u00e9sident",
  },
  {
    channelId: "",
    name: "Prime",
    handle: "Prime",
    weight: 1.8,
    kind: "founder",
    color: "#0057FF",
    tagline: "Co-fondateur Karmine Corp",
  },
  {
    channelId: "",
    name: "Eto",
    handle: "EtoStark",
    weight: 1.6,
    kind: "founder",
    color: "#FF9800",
    tagline: "Streamer KC",
  },
  {
    channelId: "",
    name: "Sheep Esports",
    handle: "SheepEsports",
    weight: 1.0,
    kind: "scene",
    color: "#7B8DB5",
    tagline: "News + analyses esport",
  },
];

/**
 * Returns only channels that have a real ID configured. Handy for the
 * fetcher so it doesn't waste a request per empty placeholder.
 */
export function getActiveChannels(): CuratedChannel[] {
  return KC_YOUTUBE_CHANNELS.filter((c) => c.channelId.length > 0);
}
