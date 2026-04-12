import type { MetadataRoute } from "next";
import { ERAS } from "@/lib/eras";
import { ALUMNI } from "@/lib/alumni";
import { loadRealData, getKCRoster } from "@/lib/real-data";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://kckills.com");

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const data = loadRealData();
  const roster = getKCRoster(data);

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

  return [...staticPages, ...eraPages, ...alumniPages, ...playerPages, ...matchPages];
}
