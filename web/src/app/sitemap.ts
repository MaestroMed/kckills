import type { MetadataRoute } from "next";
import { ERAS } from "@/lib/eras";
import { ALUMNI } from "@/lib/alumni";
import { loadRealData, getKCRoster } from "@/lib/real-data";
import { getPublishedKills } from "@/lib/supabase/kills";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://kckills.com");

// Cap how many clip URLs we expose in the sitemap so it stays under
// Google's 50K-entry / 50MB hard limit even at scale, and so the
// sitemap fetch at build time doesn't pull the entire kills table.
// Phase 4 — bumped from 500 → 5000 once the catalog crossed 350+
// published clips with growth velocity. Google's per-file cap is 50k
// so we still have headroom; Vercel ISR builds the file in <2s at
// 5k since the SELECT is index-backed (idx_kills_published).
const SITEMAP_MAX_CLIPS = 5000;
// Limits for the auxiliary entity pages — sized so the per-file URL
// count comfortably stays under Google's 50K cap once ALL buckets
// (clips + players + matches + champions + matchups + static)
// are merged.
const SITEMAP_MAX_PLAYERS = 200;
const SITEMAP_MAX_MATCHES = 200;

// ISR cadence for the sitemap itself. 1h is the sweet spot per the
// Phase 4 SEO spec : fresh enough for newly-published clips to hit
// the index quickly, slow enough that we don't hammer Supabase on
// every Googlebot fetch (Vercel caches the response between builds).
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const data = loadRealData();
  const roster = getKCRoster(data);

  // Pull the top published clips for indexation. Sorted by highlight_score
  // server-side, so Google sees the best ones first. Falls back to []
  // if Supabase is unreachable at build — the deploy still ships, just
  // without per-clip URLs that build (ISR populates on first hit).
  // buildTime: true so cookies() isn't called from sitemap-build context.
  const publishedKills = await getPublishedKills(SITEMAP_MAX_CLIPS, { buildTime: true }).catch(() => []);

  // Only canonical routes here — any path that just redirect()s to
  // another URL (e.g. /best, /top, /recent, /hall-of-fame) is dropped
  // so we don't waste Google's crawl budget on 308 redirects. The
  // target routes carry the weight instead.
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${SITE_URL}/scroll`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/clips`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/records`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/week`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${SITE_URL}/matches`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/players`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/alumni`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.65,
    },
    {
      url: `${SITE_URL}/api-docs`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.2,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  const eraPages: MetadataRoute.Sitemap = ERAS.map((era) => ({
    url: `${SITE_URL}/era/${era.id}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.7,
  }));

  // /alumni is already in staticPages; here we just add the per-alumni detail.
  const alumniPages: MetadataRoute.Sitemap = ALUMNI.map((a) => ({
    url: `${SITE_URL}/alumni/${a.slug}`,
    lastModified: now,
    changeFrequency: "monthly" as const,
    priority: 0.55,
  }));

  // Player pages — top N by total kills so the most relevant profiles
  // get priority crawl signal. Sort first then slice — the Phase 4
  // spec asks for top 200 by total kills, but the live KC/alumni
  // roster only has ~30 names; the cap is here for when historical
  // backfills bring us above that bar.
  const playerPages: MetadataRoute.Sitemap = [...roster]
    .sort((a, b) => b.totalKills - a.totalKills)
    .slice(0, SITEMAP_MAX_PLAYERS)
    .map((player) => ({
      url: `${SITE_URL}/player/${encodeURIComponent(player.name)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

  // Match pages — keep the last 12 months at full priority so Google
  // sees the freshest competitive context first. Older matches still
  // resolve via the on-demand /match/[id] route, they just don't get
  // sitemap signal beyond the 200-row cap.
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const recentMatches = data.matches
    .filter((m) => new Date(m.date) >= twelveMonthsAgo)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, SITEMAP_MAX_MATCHES);
  const matchPages: MetadataRoute.Sitemap = recentMatches.map((match) => ({
    url: `${SITE_URL}/match/${match.id}`,
    lastModified: new Date(match.date),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  // Per-champion URLs derived from the kills sample we already have in
  // memory (no extra DB hit). Each champion gets a stable URL even if
  // they only appear once — keeps the index growing organically as new
  // metas roll through KC's pick pool.
  const championNames = new Set<string>();
  // Track every (killer, victim) pair we've actually seen in the catalog so
  // the sitemap only exposes matchup URLs that resolve to real content.
  // Order-independent — we canonicalise to alpha order so /matchup/A/vs/B
  // and /matchup/B/vs/A collapse to a single entry.
  const matchupPairs = new Set<string>();
  for (const k of publishedKills) {
    if (k.killer_champion) championNames.add(k.killer_champion);
    if (k.victim_champion) championNames.add(k.victim_champion);
    if (k.killer_champion && k.victim_champion && k.killer_champion !== k.victim_champion) {
      const [a, b] = [k.killer_champion, k.victim_champion].sort();
      matchupPairs.add(`${a}|${b}`);
    }
  }
  const championPages: MetadataRoute.Sitemap = [...championNames].map((c) => ({
    url: `${SITE_URL}/champion/${encodeURIComponent(c)}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: 0.55,
  }));

  const matchupPages: MetadataRoute.Sitemap = [...matchupPairs].map((pair) => {
    const [a, b] = pair.split("|");
    return {
      url: `${SITE_URL}/matchup/${encodeURIComponent(a)}/vs/${encodeURIComponent(b)}`,
      lastModified: now,
      changeFrequency: "weekly" as const,
      priority: 0.5,
    };
  });

  // Per-clip URLs — the actual content Google should index. Priority is
  // attenuated by highlight score so the index gets a quality signal,
  // and freshness is amplified for the last-90-days window so the
  // crawler revisits hot content. Phase 4 spec :
  //   - priority 0.5-0.9 mapped from highlight_score (1-10)
  //   - changeFreq monthly (kills don't change once published, only
  //     ratings do — and ratings refresh via React Query, not crawl)
  const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const clipPages: MetadataRoute.Sitemap = publishedKills.map((k) => {
    const score = typeof k.highlight_score === "number" ? k.highlight_score : 5;
    // Map highlight 1-10 → priority 0.5-0.9 (top clips outrank generic
    // landing pages but never beat the homepage).
    let priority = Math.max(0.5, Math.min(0.9, 0.5 + (score / 10) * 0.4));
    const created = k.created_at ? new Date(k.created_at) : now;
    // Recent clip → bump priority slightly so Google prioritises
    // crawling the freshest content within the same score band.
    if (created.getTime() >= ninetyDaysAgo) {
      priority = Math.min(0.9, priority + 0.05);
    }
    return {
      url: `${SITE_URL}/kill/${k.id}`,
      lastModified: created,
      changeFrequency: "monthly" as const,
      priority: Math.round(priority * 100) / 100,
    };
  });

  return [
    ...staticPages,
    ...eraPages,
    ...alumniPages,
    ...playerPages,
    ...championPages,
    ...matchupPages,
    ...matchPages,
    ...clipPages,
  ];
}
