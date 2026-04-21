import type { Metadata, Viewport } from "next";
import Script from "next/script";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* Preload the primary display font so the hero headline renders without FOIT */}
        <link
          rel="preload"
          as="style"
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter+Tight:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Inter+Tight:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;700&display=swap"
          rel="stylesheet"
        />
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
        <Providers>
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
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}` }} />
      </body>
    </html>
  );
}
