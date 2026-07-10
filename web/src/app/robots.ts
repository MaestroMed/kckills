import type { MetadataRoute } from "next";
// Wave 38.2 — shared SITE_URL (was a local VERCEL_URL-first copy that
// could point robots/sitemap at vercel.app in prod).
import { SITE_URL } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        // Wave 38.2 — "/api/og/" allow: longest-match beats the "/api/"
        // disallow, so Twitterbot/Googlebot-Image can fetch the og:image
        // every kill page points at (blocked cards render with no image).
        allow: ["/", "/api/og/"],
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
        allow: ["/", "/api/og/"],
        // Wave 38.2 — "/settings" added here too: Googlebot obeys ONLY its
        // own group and ignores "*", so the wildcard disallow was dead for
        // Google and the settings page was crawlable.
        disallow: [
          "/api/",
          "/admin/",
          "/auth/",
          "/settings",
          "/review",
          "/era/darkness",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
