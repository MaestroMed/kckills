import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Navbar } from "@/components/navbar";
import { LiveBanner } from "@/components/LiveBanner";
import { Providers } from "@/components/Providers";

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
  authors: [{ name: "Mehdi Numelite" }],
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
  },
  twitter: {
    card: "summary_large_image",
    title: "KCKILLS",
    description: "Le TikTok des kills LoL esport.",
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
};

export const viewport: Viewport = {
  themeColor: "#C8AA6E",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
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
        <LiveBanner />
        <Navbar />
        <main id="main-content" className="mx-auto max-w-7xl px-4 py-6">{children}</main>
        <footer className="border-t border-[var(--border-gold)] mt-16">
          <div className="mx-auto max-w-7xl px-4 py-10">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              {/* Brand */}
              <div>
                <p className="font-display text-lg font-bold">KC<span className="text-[var(--gold)]">Tok</span></p>
                <p className="text-xs text-[var(--text-muted)] mt-1">Every kill. Rated. Remembered.</p>
              </div>
              {/* Nav */}
              <div className="flex gap-6 text-xs text-[var(--text-muted)]">
                <a href="/" className="hover:text-[var(--gold)]">Accueil</a>
                <a href="/scroll" className="hover:text-[var(--gold)]">Scroll</a>
                <a href="/players" className="hover:text-[var(--gold)]">Joueurs</a>
                <a href="/matches" className="hover:text-[var(--gold)]">Matchs</a>
                <a href="/top" className="hover:text-[var(--gold)]">Top</a>
                <a href="/community" className="hover:text-[var(--gold)]">Community</a>
              </div>
              {/* Discord */}
              <a href="/login" className="inline-flex items-center gap-2 rounded-lg border border-[#5865F2]/20 bg-[#5865F2]/5 px-3 py-1.5 text-xs text-[#8B9DFF] hover:bg-[#5865F2]/10">
                <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
                Rejoindre Discord
              </a>
            </div>
            {/* Riot disclaimer */}
            <div className="gold-line mt-8 mb-4" />
            <p className="text-[11px] text-[var(--text-muted)] leading-relaxed text-center">
              KCKILLS was created under Riot Games&apos; &quot;Legal Jibber Jabber&quot; policy using assets owned by Riot Games.
              Riot Games does not endorse or sponsor this project.
            </p>
            <p className="text-[10px] text-[var(--text-disabled)] text-center mt-2">
              Construit par Mehdi (Numelite) avec Claude (Kairos). &copy; 2026
            </p>
          </div>
        </footer>
        </Providers>
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js')}` }} />
      </body>
    </html>
  );
}
