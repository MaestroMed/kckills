"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "@/components/navbar";
import { LiveBanner } from "@/components/LiveBanner";

/**
 * Conditionally renders the site chrome (navbar, footer) based on pathname.
 * On /scroll, we go full immersive — no navbar, no footer, 100% clip.
 */
export function LayoutChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isImmersive = pathname === "/scroll";
  const isAdmin = pathname.startsWith("/admin");

  // Admin routes use their own layout (sidebar-based). Skip public chrome entirely.
  if (isAdmin) {
    return <>{children}</>;
  }

  if (isImmersive) {
    // Full-screen immersive mode: just render children (the scroll feed).
    // Riot's "Legal Jibber Jabber" policy requires the disclaimer on every
    // public page, including /scroll — kept as a discreet bottom overlay
    // so it doesn't fight the TikTok-style UI.
    return (
      <>
        {children}
        <p
          aria-label="Riot Games disclaimer"
          className="pointer-events-none fixed inset-x-0 bottom-1 z-50 px-4 text-center text-[9px] leading-tight text-white/40 mix-blend-difference"
        >
          KCKILLS is not endorsed by Riot Games. Assets &copy; Riot Games.
        </p>
      </>
    );
  }

  return (
    <>
      <LiveBanner />
      <Navbar />
      <main id="main-content" className="mx-auto max-w-7xl px-4 py-6">
        {children}
      </main>
      <footer className="border-t border-[var(--border-gold)] mt-16">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="font-display text-lg font-black tracking-[0.1em]">
                KC<span className="text-[var(--gold)]">KILLS</span>
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-1">Every kill. Rated. Remembered.</p>
            </div>
            <div className="flex gap-6 text-xs text-[var(--text-muted)]">
              <a href="/" className="hover:text-[var(--gold)]">Accueil</a>
              <a href="/scroll" className="hover:text-[var(--gold)]">Scroll</a>
              <a href="/players" className="hover:text-[var(--gold)]">Joueurs</a>
              <a href="/matches" className="hover:text-[var(--gold)]">Matchs</a>
              <a href="/top" className="hover:text-[var(--gold)]">Top</a>
              <a href="/community" className="hover:text-[var(--gold)]">Community</a>
              <a href="/api-docs" className="hover:text-[var(--gold)]">API</a>
              <a href="/privacy" className="hover:text-[var(--gold)]">Confidentialit&eacute;</a>
            </div>
            <a href="/login" className="inline-flex items-center gap-2 rounded-lg border border-[#5865F2]/20 bg-[#5865F2]/5 px-3 py-1.5 text-xs text-[#8B9DFF] hover:bg-[#5865F2]/10">
              <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
              </svg>
              Rejoindre Discord
            </a>
          </div>
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
    </>
  );
}
