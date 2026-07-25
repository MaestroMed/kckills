import type { MetadataRoute } from "next";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  // Audit 2.0 : en PRODUCTION on force le domaine canonique. Avant, le
  // fallback VERCEL_URL renvoyait l'URL de déploiement (kckills-xxx.
  // vercel.app), qui partait dans les 1978 URLs du sitemap, robots.txt,
  // canonical et og:url — le site s'auto-désindexait au profit d'un host
  // jetable. NEXT_PUBLIC_SITE_URL reste prioritaire si elle est définie.
  (process.env.VERCEL_ENV === "production"
    ? "https://www.kckills.com"
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");

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
