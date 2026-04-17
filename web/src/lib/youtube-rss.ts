/**
 * YouTube RSS feed fetcher.
 *
 * Each public channel exposes its 15 latest uploads at
 *   `https://www.youtube.com/feeds/videos.xml?channel_id=UC...`
 *
 * No API key, no quota, no auth — perfect for a server component that
 * revalidates every ~10 minutes. We parse the Atom XML with regex (the
 * shape is stable and we only read 5 fields) so we don't need to ship
 * an XML parser to the bundle. The tradeoff is intentional: less code,
 * zero deps, fast.
 *
 * If the fetch fails (channel removed, network error, RSS schema drift),
 * the channel is silently dropped. The caller falls back to the seed list
 * so the carousel always has content.
 */

import type { CuratedChannel } from "./youtube-channels";

export interface YoutubeVideo {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;       // ISO 8601
  thumbnailUrl: string;      // hqdefault from i.ytimg.com
  views: number | null;      // RSS exposes media:statistics views attr
  channel: CuratedChannel;
}

const RSS_BASE = "https://www.youtube.com/feeds/videos.xml?channel_id=";
const FETCH_TIMEOUT_MS = 6000;

/**
 * Parse one Atom <entry> block. Brittle by design — we lean on YouTube's
 * stable schema. Each capture is anchored so multi-line entries don't
 * bleed into each other.
 */
function parseEntry(block: string, channel: CuratedChannel): YoutubeVideo | null {
  const id = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(block)?.[1];
  if (!id) return null;

  const title = decodeXmlEntities(/<title>([^<]+)<\/title>/.exec(block)?.[1] ?? "");
  const published = /<published>([^<]+)<\/published>/.exec(block)?.[1] ?? "";
  const description = decodeXmlEntities(
    /<media:description>([\s\S]*?)<\/media:description>/.exec(block)?.[1]?.trim() ?? "",
  );
  const viewsRaw = /<media:statistics[^/]*views="(\d+)"/.exec(block)?.[1];
  const views = viewsRaw ? parseInt(viewsRaw, 10) : null;

  return {
    videoId: id,
    title,
    description: description.slice(0, 240),
    publishedAt: published,
    // hqdefault is the safest universal thumbnail — maxresdefault is missing
    // for ~10% of uploads (livestreams, ancient videos, age-gated content).
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    views,
    channel,
  };
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Fetch and parse one channel's RSS feed. Returns up to `limit` recent
 * videos, oldest dropped first. Quietly returns `[]` on any failure so
 * upstream code can fold the result into the merged feed without
 * try/catch noise.
 */
export async function fetchChannelVideos(
  channel: CuratedChannel,
  limit = 12,
): Promise<YoutubeVideo[]> {
  if (!channel.channelId) return [];

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(RSS_BASE + channel.channelId, {
      signal: ctrl.signal,
      // Re-fetch every 10 minutes — RSS is cheap and YouTube updates the
      // feed within ~minutes of an upload going public.
      next: { revalidate: 600, tags: ["youtube-rss", `channel-${channel.channelId}`] },
      headers: { "User-Agent": "kckills.com (+youtube-showcase)" },
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const entries = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    const videos: YoutubeVideo[] = [];
    for (const block of entries) {
      const v = parseEntry(block, channel);
      if (v) videos.push(v);
      if (videos.length >= limit) break;
    }
    return videos;
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fan-out fetch across all configured channels in parallel. Failures from
 * individual channels never poison the others — they just contribute zero
 * videos to the merged result.
 */
export async function fetchAllChannelVideos(
  channels: CuratedChannel[],
  perChannelLimit = 12,
): Promise<YoutubeVideo[]> {
  const results = await Promise.all(
    channels.map((c) => fetchChannelVideos(c, perChannelLimit)),
  );
  return results.flat();
}
