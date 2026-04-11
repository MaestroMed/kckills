"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

const NAV_LINKS = [
  { href: "/", label: "Accueil" },
  { href: "/scroll", label: "Scroll" },
  { href: "/players", label: "Joueurs" },
  { href: "/matches", label: "Matchs" },
  { href: "/top", label: "Top" },
];

export function Navbar() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; avatar: string } | null>(null);

  useEffect(() => {
    // Check auth state (when Supabase is connected)
    try {
      const { createSupabaseBrowser } = require("@/lib/supabase-browser");
      const sb = createSupabaseBrowser();
      sb.auth.getUser().then(({ data }: { data: { user: { user_metadata?: { full_name?: string; avatar_url?: string } } | null } }) => {
        if (data.user) {
          setUser({
            name: data.user.user_metadata?.full_name ?? "User",
            avatar: data.user.user_metadata?.avatar_url ?? "",
          });
        }
      });
    } catch {
      // Supabase not configured yet
    }
  }, []);

  return (
    <nav className="sticky top-0 z-50 border-b border-[var(--border-gold)] glass">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2.5">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <KCKILLSLogo />
          <span className="font-display text-lg font-bold tracking-wide hidden sm:inline">
            KC<span className="text-[var(--gold)]">Tok</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden items-center gap-5 md:flex">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--gold)] relative after:absolute after:bottom-[-14px] after:left-0 after:right-0 after:h-[2px] after:bg-[var(--gold)] after:scale-x-0 after:transition-transform hover:after:scale-x-100"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Right side — CTA + Auth */}
        <div className="hidden items-center gap-3 md:flex">
          {user ? (
            <Link href="/settings" className="flex items-center gap-2 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--gold)]/40">
              {user.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.avatar} alt="" className="h-5 w-5 rounded-full" />
              ) : (
                <div className="h-5 w-5 rounded-full bg-[var(--gold)] text-[8px] font-bold text-black flex items-center justify-center">{user.name[0]}</div>
              )}
              {user.name}
            </Link>
          ) : (
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-lg border border-[#5865F2]/30 bg-[#5865F2]/10 px-3 py-1.5 text-xs font-medium text-[#8B9DFF] transition-all hover:bg-[#5865F2]/20 hover:border-[#5865F2]/50"
          >
            <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
            </svg>
            Connexion
          </Link>
          )}
          <Link
            href="/scroll"
            className="rounded-lg bg-[var(--gold)] px-4 py-2 text-sm font-bold text-[var(--bg-primary)] transition-all hover:bg-[var(--gold-bright)] hover:shadow-lg hover:shadow-[var(--gold)]/20"
          >
            Scroll les kills
          </Link>
        </div>

        {/* Mobile menu button */}
        <button
          className="md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Menu"
        >
          <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="border-t border-[var(--border-gold)] px-4 py-3 md:hidden space-y-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="block rounded-lg py-2.5 px-3 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors"
              onClick={() => setMobileOpen(false)}
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-2 flex gap-2">
            <Link
              href="/login"
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#5865F2] py-2.5 text-sm font-medium text-white"
              onClick={() => setMobileOpen(false)}
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
              </svg>
              Discord
            </Link>
            <Link
              href="/scroll"
              className="flex-1 rounded-lg bg-[var(--gold)] py-2.5 text-center text-sm font-bold text-[var(--bg-primary)]"
              onClick={() => setMobileOpen(false)}
            >
              Scroll
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}

function KCKILLSLogo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Hextech-inspired logo */}
      <rect width="32" height="32" rx="8" fill="url(#logo-gradient)" />
      {/* L shape */}
      <path d="M9 8h3v12h6v3H9V8z" fill="#010A13" />
      {/* T shape */}
      <path d="M14 8h9v3h-3v12h-3V11h-3V8z" fill="#010A13" />
      {/* Gold accent line */}
      <rect x="0" y="0" width="32" height="2" rx="1" fill="#C8AA6E" opacity="0.6" />
      <defs>
        <linearGradient id="logo-gradient" x1="0" y1="0" x2="32" y2="32">
          <stop stopColor="#C89B3C" />
          <stop offset="1" stopColor="#785A28" />
        </linearGradient>
      </defs>
    </svg>
  );
}
