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
const SITEMAP_MAX_CLIPS = 500;

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
      url: `${SITE_URL}/best`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.85,
    },
    {
      url: `${SITE_URL}/recent`,
      lastModified: now,
      changeFrequency: "hourly",
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
      url: `${SITE_URL}/champions`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/matchups`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/multikills`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.75,
    },
    {
      url: `${SITE_URL}/top`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/community`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/hall-of-fame`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/records`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/stats`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/compare`,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 0.5,
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

  const alumniPages: MetadataRoute.Sitemap = [
    {
      url: `${SITE_URL}/alumni`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    ...ALUMNI.map((a) => ({
      url: `${SITE_URL}/alumni/${a.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.55,
    })),
  ];

  const playerPages: MetadataRoute.Sitemap = roster.map((player) => ({
    url: `${SITE_URL}/player/${encodeURIComponent(player.name)}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.6,
  }));

  const matchPages: MetadataRoute.Sitemap = data.matches.slice(0, 100).map((match) => ({
    url: `${SITE_URL}/match/${match.id}`,
    lastModified: new Date(match.date),
    changeFrequency: "monthly",
    priority: 0.5,
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
  // attenuated by highlight score so the index gets a quality signal.
  const clipPages: MetadataRoute.Sitemap = publishedKills.map((k) => {
    const score = typeof k.highlight_score === "number" ? k.highlight_score : 5;
    // Map highlight 1-10 → priority 0.3-0.85 (top clips outrank generic
    // landing pages but never beat the homepage).
    const priority = Math.max(0.3, Math.min(0.85, 0.3 + (score / 10) * 0.55));
    const lastModified = k.created_at ? new Date(k.created_at) : now;
    return {
      url: `${SITE_URL}/kill/${k.id}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority,
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
