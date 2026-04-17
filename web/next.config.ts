import type { NextConfig } from "next";

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
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "ddragon.leagueoflegends.com" },
      { protocol: "https", hostname: "*.r2.cloudflarestorage.com" },
      { protocol: "https", hostname: "*.r2.dev" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "cdn.discordapp.com" },
      { protocol: "https", hostname: "clips.kckills.com" },
      { protocol: "http", hostname: "static.lolesports.com" },
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
