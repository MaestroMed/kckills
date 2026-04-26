import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "https://kckills.com");

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /admin/ added per Phase 4 SEO spec — never want the
        // editorial / pipeline / moderation surface in the index.
        disallow: [
          "/api/",
          "/admin/",
          "/auth/",
          "/_next/",
          "/settings",
          "/review",
          "/era/darkness",
        ],
      },
      {
        userAgent: "Googlebot",
        allow: "/",
        disallow: ["/api/", "/admin/", "/auth/", "/review", "/era/darkness"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
