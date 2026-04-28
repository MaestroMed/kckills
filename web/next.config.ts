import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // 'unsafe-inline' is required for Next 15's inline bootstrap script.
      // Nonce-based CSP would need middleware — out of scope for now.
      // 'unsafe-eval' removed — Next 15 does not need it in production.
      "script-src 'self' 'unsafe-inline' https://vercel.live https://*.umami.is",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://ddragon.leagueoflegends.com https://static.lolesports.com https://clips.kckills.com https://img.youtube.com https://i.ytimg.com https://*.r2.cloudflarestorage.com",
      "media-src 'self' https://clips.kckills.com https://*.r2.cloudflarestorage.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://clips.kckills.com https://fonts.googleapis.com https://fonts.gstatic.com https://ddragon.leagueoflegends.com https://static.lolesports.com https://esports-api.lolesports.com https://img.youtube.com https://vercel.live https://*.r2.cloudflarestorage.com https://*.umami.is",
      "frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com https://vercel.live",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // ─── 2026-04-28 SOTA stack (Next.js 16) ──────────────────────────
  //
  // React Compiler : auto-memoization (useMemo / useCallback are now
  // implicit, applied by the compiler at build time). Significant
  // CPU reduction across the entire React tree, especially on mobile.
  // Free perf win — also eliminates entire classes of "missing
  // dependency" performance bugs.
  reactCompiler: true,

  // PPR (renamed `cacheComponents` in Next 16) — DISABLED for now.
  // Incompatible with `export const dynamic = "force-dynamic"` used on
  // 109 routes (admin pages, API routes, dynamic pages). Migrating those
  // to Suspense-based streaming is a separate large refactor. Will
  // re-enable after the dynamic-export audit. See docs/ppr-migration.md.
  // cacheComponents: true,

  experimental: {
    // View Transitions API — native browser route transitions.
    // Replaces framer-motion AnimatePresence on page nav. Zero JS
    // cost, GPU-composited. App-like feel on mobile.
    viewTransition: true,
    // Inline critical CSS into the SSR HTML so first paint doesn't
    // wait on the stylesheet HTTP request. Big mobile latency win.
    inlineCss: true,
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ddragon.leagueoflegends.com" },
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "clips.kckills.com" },
      // Migré en https via fix mixed-content (commit fa9a428). Next
      // Image bloque le legacy http:// désormais, toutes les URLs
      // passent par https:// maintenant.
      { protocol: "https", hostname: "static.lolesports.com" },
    ],
    // Modern formats — Next.js 16 default but explicit for clarity.
    formats: ["image/avif", "image/webp"],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

// ─── Sentry wrapper (PR-loltok DB — Wave 11) ──────────────────────────
// DSN-conditional : missing NEXT_PUBLIC_SENTRY_DSN keeps prod builds
// Sentry-free. Source maps upload only when SENTRY_AUTH_TOKEN is set,
// so contributors without a token can still build successfully.
const sentryWebpackPluginOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
  // Tunnel client → /monitoring (same-origin) → Sentry, bypass ad blockers.
  tunnelRoute: "/monitoring",
  hideSourceMaps: true,
  errorHandler: (err: Error) => {
    // eslint-disable-next-line no-console
    console.warn("[sentry-webpack-plugin] non-fatal:", err.message);
  },
  reactComponentAnnotation: { enabled: false },
  disableLogger: true,
  automaticVercelMonitors: false,
};

export default process.env.NEXT_PUBLIC_SENTRY_DSN
  ? withSentryConfig(nextConfig, sentryWebpackPluginOptions)
  : nextConfig;
