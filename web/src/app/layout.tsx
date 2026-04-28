import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { LayoutChrome } from "@/components/LayoutChrome";

const UMAMI_SRC = process.env.NEXT_PUBLIC_UMAMI_SRC;
const UMAMI_WEBSITE_ID = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ??
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "KCKILLS — Every Kill. Rated. Remembered.",
    template: "%s — KCKILLS",
  },
  description:
    "Le TikTok des kills LoL. Scroll, rate, et partage chaque kill Karmine Corp de la LEC.",
  applicationName: "KCKILLS",
  authors: [{ name: "KCKILLS" }],
  keywords: [
    "Karmine Corp",
    "KC",
    "League of Legends",
    "LEC",
    "kills",
    "highlights",
    "esport",
    "LoL",
  ],
  openGraph: {
    title: "KCKILLS",
    description: "Every kill. Rated. Remembered.",
    type: "website",
    siteName: "KCKILLS",
    locale: "fr_FR",
    url: SITE_URL,
    // 1920x1280 hero shot — Discord/Twitter scale to 1200x630 in preview
    // cards but accept larger originals. Per-page metadata can override
    // this with kill-specific OG images (see /api/og/[id]).
    images: [
      {
        url: "/images/hero-bg.jpg",
        width: 1920,
        height: 1280,
        alt: "KCKILLS — clips Karmine Corp esport LoL",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "KCKILLS",
    description: "Le TikTok des kills LoL esport.",
    images: ["/images/hero-bg.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  // Explicit icons block — Next.js will only auto-discover /favicon.ico,
  // but browsers also probe /icon.svg and the PNG sizes; declaring them
  // upfront kills the 404 chain in DevTools and lets the SVG (vector,
  // crisper at any DPI) win on modern targets.
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "192x192", type: "image/png" },
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#C8AA6E",
  width: "device-width",
  initialScale: 1,
  // WCAG 1.4.4 — never block user-initiated zoom. Cap at 5x so the
  // gesture is still anchored but accessibility is preserved.
  maximumScale: 5,
  userScalable: true,
  viewportFit: "cover",
};

// JSON-LD structured data — helps Google understand the site structure
const jsonLdWebsite = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "KCKILLS",
  alternateName: "KC Kills",
  url: SITE_URL,
  description:
    "Le TikTok des kills League of Legends. Scroll, rate, et partage chaque moment Karmine Corp de la LEC.",
  inLanguage: "fr-FR",
  potentialAction: {
    "@type": "SearchAction",
    target: {
      "@type": "EntryPoint",
      urlTemplate: `${SITE_URL}/matches?q={search_term_string}`,
    },
    "query-input": "required name=search_term_string",
  },
};

const jsonLdSportsTeam = {
  "@context": "https://schema.org",
  "@type": "SportsTeam",
  name: "Karmine Corp",
  alternateName: ["KC", "KCorp"],
  url: "https://karminecorp.fr",
  sameAs: [
    "https://x.com/KarmineCorp",
    "https://www.twitch.tv/karminecorp",
    "https://www.youtube.com/@KarmineCorp",
    "https://www.instagram.com/karminecorp",
  ],
  sport: "League of Legends",
  memberOf: {
    "@type": "SportsOrganization",
    name: "LEC",
    url: "https://lolesports.com/en-US/leagues/lec",
  },
  foundingDate: "2020-03-14",
  foundingLocation: {
    "@type": "Place",
    name: "France",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 2026-04-26 cache fix : the root layout USED to call
  // `await getServerLang()` here to resolve the user's language from
  // the cookie / Accept-Language header server-side. That's a
  // beautiful UX feature (Korean visitors get a Korean first paint
  // instead of FR-then-flash-to-KR) but it has a brutal cache cost :
  // `getServerLang()` calls `cookies()` + `headers()`, both of which
  // are Next.js 15 dynamic APIs. ANY layout that touches a dynamic
  // API opts EVERY page underneath it into dynamic rendering. Result :
  // the homepage + /kill/[id] + /match/[slug] + every other public
  // page was running SSR for every single visitor (X-Vercel-Cache:
  // MISS forever) regardless of `revalidate = 300` — observed in
  // Vercel observability as 78K function invocations / 30 days that
  // should have been ~95% cached.
  //
  // The fix : default to FR for the SSR shell + let the client-side
  // LangProvider detect the cookie / localStorage on mount and
  // re-render with the user's preferred lang. Trade-off : non-FR
  // visitors see a brief (<50 ms) French flash before the client
  // hydration switches the lang. That's a one-time UX hit per visit,
  // versus a permanent 5x cost on Vercel function invocations.
  //
  // The lang switcher in the header still works — when a user picks
  // a lang explicitly, the cookie + localStorage are set and the
  // client picks them up immediately. This change ONLY affects the
  // very first paint of a visitor whose chosen lang isn't FR.
  const initialLang = "fr" as const;
  const { LANG_META } = await import("@/lib/i18n/lang");
  const htmlLang = LANG_META[initialLang].htmlLang;

  return (
    <html lang={htmlLang}>
      <head>
        <link rel="manifest" href="/manifest.json" />
        {/* ─── Preconnects ────────────────────────────────────────────
            Wave 7 perf audit (2026-04-25, Agent AE) — every cold mobile
            visit pays a fresh DNS+TLS handshake (~120-150 ms each) the
            moment the parser hits the first <Image src="https://…" />
            referencing one of these origins. Preconnecting in the doc
            head warms the connection in parallel with HTML parsing so
            the first poster / champion icon / R2 asset paints faster.

              • fonts.googleapis.com / fonts.gstatic.com — already in
                use for Oswald/Inter Tight/JetBrains Mono.
              • clips.kckills.com — primary R2 CDN for clips, posters,
                thumbnails, OG images. Hit on EVERY page that renders
                a kill (scroll, kill detail, search, player, top, …).
              • ddragon.leagueoflegends.com — champion icons + splashes
                (home roster band, kill detail, player profile).
              • *.r2.cloudflarestorage.com — legacy R2 direct hostname
                for assets not yet migrated behind the custom domain.

            crossOrigin="" is required for fetch-style CORS preconnect
            on the gstatic & R2 endpoints; HTML lint flags `crossOrigin`
            on origins that don't need credentials but the spec is happy. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="preconnect" href="https://clips.kckills.com" crossOrigin="" />
        <link rel="preconnect" href="https://ddragon.leagueoflegends.com" />
        <link rel="dns-prefetch" href="https://r2.cloudflarestorage.com" />
        {/* ─── Non-blocking Google Fonts ──────────────────────────────
            Wave 7 perf audit (2026-04-25) — the previous setup shipped
            BOTH a `<link rel="preload" as="style">` AND a render-blocking
            `<link rel=stylesheet>` for the same URL. The stylesheet
            form blocked first paint until the CSS roundtrip resolved
            (~200-400 ms on 4G).

            New pattern (canonical async-CSS recipe):
              1. `<link rel="preload" as="style">` warms the request so
                 it lands in the browser cache early.
              2. `<link rel="stylesheet" media="print">` LOADS the same
                 URL but with a media query that doesn't apply to screen
                 — the browser fetches it but DOES NOT render-block.
                 The inline script below flips `media` to `"all"` once
                 it loads. Net effect: zero render-block, fonts apply
                 the moment they finish downloading.
              3. <noscript> fallback ships the blocking version for
                 crawlers + JS-off users.

            display=swap is on the URL itself — text paints in the
            fallback font immediately, then re-renders in Oswald/Inter
            once available. Eliminates FOIT entirely. */}
        <link
          rel="preload"
          as="style"
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter+Tight:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
        <link
          id="kc-fonts"
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter+Tight:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
          media="print"
        />
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){var l=document.getElementById('kc-fonts');if(l){l.addEventListener('load',function(){l.media='all'});if(l.sheet){l.media='all'}}})();",
          }}
        />
        <noscript>
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter+Tight:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
          />
        </noscript>
        {/* JSON-LD structured data for SEO */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdWebsite) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdSportsTeam) }}
        />
      </head>
      <body className="min-h-screen antialiased">
        {/* a11y: skip to content */}
        <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-lg focus:bg-[var(--gold)] focus:px-4 focus:py-2 focus:text-black focus:text-sm focus:font-bold">
          Aller au contenu
        </a>
        <Providers initialLang={initialLang}>
        <LayoutChrome>
          {children}
        </LayoutChrome>
        </Providers>
        {UMAMI_SRC && UMAMI_WEBSITE_ID ? (
          <Script
            src={UMAMI_SRC}
            data-website-id={UMAMI_WEBSITE_ID}
            strategy="afterInteractive"
            defer
          />
        ) : null}
        {/* 📊 Vercel Analytics + Speed Insights (Wave 13d, 2026-04-28).
            Free, edge-level tracking that captures EVERY page load
            without depending on the JS tracker (which adblockers
            kill ~94 % of the time per the 2026-04-28 Cloudflare audit).
            Privacy-first by default — no cookies, no PII, GDPR-clean. */}
        <Analytics />
        <SpeedInsights />
        {/* 🖼 Server-side noscript pixel fallback. Fires for visitors
            who block our /api/track POST (uBlock + privacy lists) but
            still load IMG tags. Inserts a single page.viewed event
            per visitor-bucket per day, deduplicated server-side. */}
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/api/track/pixel?p=fallback"
            alt=""
            width={1}
            height={1}
            style={{ position: "absolute", left: -9999, top: -9999 }}
          />
        </noscript>
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}` }} />
      </body>
    </html>
  );
}
