// Wave 38.2 — single source of truth for the canonical site origin.
// Logic copied verbatim from the Wave 38 layout.tsx fix: if
// NEXT_PUBLIC_SITE_URL is missing in prod we must NOT emit vercel.app or
// localhost canonicals — Search Console would see split/duplicate
// indexation. On Vercel, VERCEL_URL is ALWAYS the *.vercel.app deployment
// hostname (never the custom domain), so it only wins outside production.
// Previously layout.tsx, sitemap.ts, robots.ts, lib/seo/jsonld.tsx,
// scroll/page.tsx, c/[shortCode]/page.tsx and search/page.tsx each kept
// their own divergent derivation — all import this constant now.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.NODE_ENV === "production"
    ? "https://kckills.com"
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000");
