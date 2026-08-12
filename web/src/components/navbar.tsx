"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";
import { CommandPaletteButton } from "./CommandPalette";
import { LangSwitcher } from "./i18n/LangSwitcher";
import { SearchBar } from "./search/SearchBar";
import { LeagueNav } from "./league/LeagueNav";
import { HeaderAura } from "./HeaderAura";
import { useT } from "@/lib/i18n/use-lang";

// PR-loltok BC : env-gated multi-league chip strip.
// `NEXT_PUBLIC_LOLTOK_PUBLIC` is exposed to the client bundle via the
// NEXT_PUBLIC_ prefix, so the same value is read on server (RSC parent)
// and client (this component) — there's no hydration mismatch.
//
// Default `false` → the chip strip is hidden, the navbar looks
// byte-identical to today's KC pilot. Set to `true` in Vercel env to
// flip on the LoLTok multi-team navigation.
const LOLTOK_PUBLIC = process.env.NEXT_PUBLIC_LOLTOK_PUBLIC === "true";

// Header 2.0 — étendards « vrai tissu » : petit canvas R3F chargé en lazy,
// desktop uniquement, après idle, si WebGL dispo et hors reduced-motion.
// Le fallback SVG statique s'affiche instantanément et reste la version
// mobile / reduced-motion / no-WebGL.
const KCPennantCloth = dynamic(() => import("./KCPennantCloth"), {
  ssr: false,
});

// Vague 5 (audit 2026-07-05) — the flat 4-link nav left ~10 rich pages
// (/vs, /quotes, /face-off, /bracket, /achievements, /records, /week,
// /alumni…) unreachable from any public surface. Four universes now
// expose everything: direct links for the two core surfaces + three
// dropdown groups. Labels are i18n keys resolved via t().
const NAV_DIRECT: { href: string; tKey: string }[] = [
  { href: "/scroll", tKey: "nav.scroll" },
  { href: "/clips", tKey: "nav.clips" },
];

const NAV_GROUPS: { tKey: string; items: { href: string; tKey: string }[] }[] = [
  {
    tKey: "nav.g_discover",
    items: [
      { href: "/week", tKey: "nav.week" },
      { href: "/clips?sort=score", tKey: "nav.best" },
      { href: "/records", tKey: "nav.records" },
      { href: "/saved", tKey: "nav.saved" },
    ],
  },
  {
    tKey: "nav.g_compete",
    items: [
      { href: "/vs", tKey: "nav.vs" },
      { href: "/vs/leaderboard", tKey: "nav.vs_leaderboard" },
      { href: "/face-off", tKey: "nav.face_off" },
      { href: "/bracket", tKey: "nav.bracket" },
      { href: "/quotes", tKey: "nav.quotes" },
    ],
  },
  {
    tKey: "nav.g_club",
    items: [
      { href: "/players", tKey: "nav.players" },
      { href: "/matches", tKey: "nav.matches" },
      { href: "/achievements", tKey: "nav.achievements" },
      { href: "/community", tKey: "nav.community" },
      { href: "/alumni", tKey: "nav.alumni" },
      { href: "/hall-of-fame", tKey: "nav.hall_of_fame" },
      // Wave 36 — the two hidden experiences surface in the nav. La
      // Chambre existed with zero inbound link outside the homepage ;
      // l'Antre was only reachable by typing B-C-C on Bo's page.
      { href: "/chambre", tKey: "nav.chambre" },
      { href: "/antre", tKey: "nav.antre" },
    ],
  },
];

export function Navbar() {
  const t = useT();
  const pathname = usePathname();
  // Active-section detection : a link is active on its exact route or any
  // sub-route (/players/caliste highlights "Joueurs"). The home "/" is
  // intentionally excluded so the logo, not a nav item, owns the landing.
  const isActiveLink = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [user, setUser] = useState<{ name: string; avatar: string } | null>(null);
  // Header 2.0 — passe à true quand on peut monter les étendards en tissu
  // 3D (desktop, WebGL, pas de reduced-motion, après idle).
  const [clothReady, setClothReady] = useState(false);
  useEffect(() => {
    if (window.innerWidth < 1024) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const probe = document.createElement("canvas");
    const hasGL = !!(
      probe.getContext("webgl2") ?? probe.getContext("webgl")
    );
    if (!hasGL) return;
    const arm = () => setClothReady(true);
    if ("requestIdleCallback" in window) {
      const id = (window as Window & typeof globalThis).requestIdleCallback(arm, { timeout: 2500 });
      return () => (window as Window & typeof globalThis).cancelIdleCallback(id);
    }
    const timer = setTimeout(arm, 1200);
    return () => clearTimeout(timer);
  }, []);
  // Wave 35 #13 — scroll-reactive condensing header (the premium signal).
  // At top of page the bar is tall + airy ; once the user scrolls past a
  // small threshold it condenses (shorter, solid bg, sharper border) like
  // Linear/Vercel. rAF-throttled so the scroll listener never janks.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        setScrolled(window.scrollY > 24);
        raf = 0;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  // ── Mobile drawer UX hardening ──────────────────────────────────────
  // - Esc closes the drawer (a11y)
  // - Body scroll is locked while it's open so the underlying page
  //   doesn't scroll behind it (KC fanbase is mostly mobile, this is
  //   the one nav blocker called out in the 20-point audit)
  // - Drawer auto-closes when the viewport is resized to >= md so
  //   landscape rotation doesn't leave the menu open AND the desktop
  //   nav both rendered.
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    const onResize = () => {
      if (window.innerWidth >= 768) setMobileOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [mobileOpen]);

  useEffect(() => {
    // Check auth state (when Supabase is connected). Dynamic import keeps
    // the Supabase client out of the navbar's synchronous graph (the old
    // `require()` defeated tree-shaking and static analysis).
    let cancelled = false;
    import("@/lib/supabase-browser")
      .then(({ createSupabaseBrowser }) => {
        const sb = createSupabaseBrowser();
        return sb.auth.getUser();
      })
      .then(({ data }: { data: { user: { user_metadata?: { full_name?: string; avatar_url?: string } } | null } }) => {
        if (!cancelled && data.user) {
          setUser({
            name: data.user.user_metadata?.full_name ?? "User",
            avatar: data.user.user_metadata?.avatar_url ?? "",
          });
        }
      })
      .catch(() => {
        // Supabase not configured yet
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    // Header 2.0 (Mehdi 2026-08-12) — the bar no longer runs edge-to-edge :
    // a sticky transparent wrapper carries a FLOATING rounded command bar
    // (max-w-7xl), flanked by two heraldic KC pennants hanging from its
    // corners. The wrapper itself never intercepts clicks.
    <div className="sticky top-0 z-50 px-2 pt-2 sm:px-4 sm:pt-3 pointer-events-none">
      <nav
        data-scrolled={scrolled}
        className="pointer-events-auto relative mx-auto max-w-7xl"
      >
        {/* Étendards KC — décoratifs, hors flux, accrochés sous les coins.
            Tissu 3D quand la machine le permet, SVG statique sinon. */}
        <div aria-hidden className="kc-pennant-wrap kc-pennant-wrap--left hidden lg:block">
          {clothReady ? (
            <div className="kc-pennant-cloth">
              <KCPennantCloth side="left" />
            </div>
          ) : (
            <KCPennantStatic side="left" />
          )}
        </div>
        <div aria-hidden className="kc-pennant-wrap kc-pennant-wrap--right hidden lg:block">
          {clothReady ? (
            <div className="kc-pennant-cloth">
              <KCPennantCloth side="right" />
            </div>
          ) : (
            <KCPennantStatic side="right" />
          )}
        </div>

        <div
          className={`relative rounded-2xl border glass-bar transition-[border-color,box-shadow] duration-500 ${
            scrolled
              ? "border-[var(--gold)]/30 shadow-[0_12px_40px_-12px_rgba(0,0,0,0.8),0_0_24px_-8px_rgba(200,170,110,0.25)]"
              : "border-[var(--border-gold)] shadow-[0_8px_30px_-16px_rgba(0,0,0,0.7)]"
          }`}
        >
          {/* Wave 35 #13 — "Hextech Command Bar" backdrop, clipped to the
              rounded floating bar. */}
          <div className="absolute inset-0 overflow-hidden rounded-2xl">
            <HeaderAura scrolled={scrolled} />
          </div>
          <div
            className={`relative z-10 flex items-center justify-between px-4 transition-[padding] duration-500 ${
              scrolled ? "py-1.5" : "py-3"
            }`}
          >
            {/* Logo */}
            <Link href="/" className="flex items-center gap-2.5 group">
              <KCKILLSLogo />
              <span className="font-display text-base md:text-lg font-black tracking-[0.1em] hidden sm:inline drop-shadow-[0_0_8px_rgba(200,170,110,0.35)]">
                KC<span className="text-[var(--gold)]">KILLS</span>
              </span>
            </Link>

            {/* Desktop nav — 2 direct links + 3 universe dropdowns */}
            <div className="hidden items-center gap-5 md:flex">
              {NAV_DIRECT.map((link) => {
                const active = isActiveLink(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`relative text-sm transition-colors after:absolute after:bottom-[-7px] after:left-0 after:right-0 after:h-[2px] after:rounded-full after:origin-left after:transition-transform after:duration-300 after:[background-image:linear-gradient(90deg,var(--gold),var(--blue-kc))] hover:after:scale-x-100 ${
                      active
                        ? "text-[var(--gold-bright)] after:scale-x-100"
                        : "text-[var(--text-muted)] hover:text-[var(--gold)] after:scale-x-0"
                    }`}
                  >
                    {t(link.tKey)}
                  </Link>
                );
              })}
              {NAV_GROUPS.map((group) => {
                const groupActive = group.items.some((i) => isActiveLink(i.href));
                return (
                  // CSS-driven dropdown: opens on hover AND :focus-within, so
                  // it's fully keyboard-navigable without any JS state (Tab
                  // into the button, Tab through the items, Esc/blur closes).
                  <div key={group.tKey} className="group/nav relative">
                    <button
                      type="button"
                      aria-haspopup="true"
                      className={`relative flex items-center gap-1 text-sm transition-colors after:absolute after:bottom-[-7px] after:left-0 after:right-0 after:h-[2px] after:rounded-full after:origin-left after:transition-transform after:duration-300 after:[background-image:linear-gradient(90deg,var(--gold),var(--blue-kc))] group-hover/nav:after:scale-x-100 ${
                        groupActive
                          ? "text-[var(--gold-bright)] after:scale-x-100"
                          : "text-[var(--text-muted)] hover:text-[var(--gold)] after:scale-x-0"
                      }`}
                    >
                      {t(group.tKey)}
                      <svg
                        className="h-3 w-3 opacity-60 transition-transform group-hover/nav:rotate-180 group-focus-within/nav:rotate-180"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        aria-hidden
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    <div className="invisible absolute left-1/2 top-full z-50 -translate-x-1/2 pt-3 opacity-0 transition-all duration-150 group-hover/nav:visible group-hover/nav:opacity-100 group-focus-within/nav:visible group-focus-within/nav:opacity-100">
                      <div className="min-w-[200px] rounded-xl border border-[var(--border-gold)] bg-[var(--bg-primary)]/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
                        {group.items.map((item) => {
                          const active = isActiveLink(item.href);
                          return (
                            <Link
                              key={item.href}
                              href={item.href}
                              aria-current={active ? "page" : undefined}
                              className={`block rounded-lg px-3 py-2 text-sm transition-colors ${
                                active
                                  ? "bg-[var(--bg-elevated)] text-[var(--gold-bright)]"
                                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--gold)]"
                              }`}
                            >
                              {t(item.tKey)}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Right side — Search (UNIQUE) + Lang + Auth + CTA.
                Header 2.0 : l'ancien couple SearchBar inline + bouton
                palette est mutualisé en UN SEUL contrôle qui ouvre la
                palette ⌘K (elle-même reliée à /search pour le full-text). */}
            <div className="hidden items-center gap-3 md:flex">
              <CommandPaletteButton className="lg:min-w-[200px]" />
              <LangSwitcher />
              {user ? (
                <Link href="/settings" className="flex items-center gap-2 rounded-lg border border-[var(--border-gold)] bg-[var(--bg-surface)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--gold)]/40">
                  {user.avatar ? (
                    <Image
                      src={user.avatar}
                      alt=""
                      width={20}
                      height={20}
                      className="h-5 w-5 rounded-full"
                      unoptimized
                    />
                  ) : (
                    <div className="h-5 w-5 rounded-full bg-[var(--gold)] text-[8px] font-bold text-black flex items-center justify-center">{user.name[0]}</div>
                  )}
                  {user.name}
                </Link>
              ) : (
                // Header 2.0 — Discord réduit en icône (le label vit dans
                // aria-label + title pour l'accessibilité et le survol).
                <Link
                  href="/login"
                  aria-label={t("nav.cta_login")}
                  title={t("nav.cta_login")}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[#5865F2]/30 bg-[#5865F2]/10 text-[#8B9DFF] transition-all hover:bg-[#5865F2]/25 hover:border-[#5865F2]/60 hover:text-[#AEBBFF]"
                >
                  <DiscordIcon className="h-4.5 w-4.5" />
                </Link>
              )}
              {/* Header 2.0 — LE CTA signature : pas de bouton, juste le mot
                  « SCROLL » en lettrage varsity collé, gros contours, glow
                  néon 80s au hover. */}
              <Link
                href="/scroll"
                className="scroll-wordmark rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--gold)]"
                aria-label={t("nav.cta_scroll_kills")}
              >
                <ScrollWordmark label={t("nav.scroll")} />
              </Link>
            </div>

            {/* Mobile : palette trigger + menu button.
                Vague 5 — this icon used to link to /search; the CommandPalette
                (the only entry point to ~80% of the content) was undiscoverable
                on mobile. It now opens the palette; /search stays reachable
                through the drawer's SearchBar. */}
            <div className="flex items-center md:hidden">
              <button
                type="button"
                onClick={() => window.dispatchEvent(new Event("kckills:open-palette"))}
                className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--gold)] hover:bg-[var(--bg-elevated)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
                aria-label={t("nav.search_aria")}
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 1 1-14 0 7 7 0 0 1 14 0z" />
                </svg>
              </button>

              {/* Mobile menu button — meets WCAG 4.4 (target ≥ 44px on touch) */}
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:text-[var(--gold)] hover:bg-[var(--bg-elevated)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]"
                onClick={() => setMobileOpen((v) => !v)}
                aria-label={mobileOpen ? t("nav.menu_close") : t("nav.menu_open")}
                aria-expanded={mobileOpen}
                aria-controls="mobile-nav"
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
          </div>

          {/* PR-loltok BC : LeagueNav chip strip — only mounts when
              NEXT_PUBLIC_LOLTOK_PUBLIC=true. In KC pilot mode (default)
              the component returns null so the navbar is identical to
              today's homepage. The chip strip sits BELOW the main nav row
              so it scrolls horizontally on mobile without disrupting the
              burger / search button. */}
          <div className="relative z-10">
            <LeagueNav enabled={LOLTOK_PUBLIC} />
          </div>

          {/* Mobile menu */}
          {mobileOpen && (
            <div id="mobile-nav" className="relative z-10 max-h-[calc(100dvh-6rem)] overflow-y-auto rounded-b-2xl border-t border-[var(--border-gold)] px-4 py-3 md:hidden space-y-1 bg-[var(--bg-primary)]/85 backdrop-blur">
              {/* Wave 6 — inline search bar in the mobile drawer. Tapping a
                  recent search closes the drawer naturally via navigation. */}
              <div className="pb-2">
                <SearchBar />
              </div>
              {NAV_DIRECT.map((link) => {
                const active = isActiveLink(link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={`block rounded-lg py-2.5 px-3 text-sm transition-colors ${
                      active
                        ? "bg-[var(--bg-elevated)] text-[var(--gold-bright)] border-l-2 border-[var(--gold)]"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                    }`}
                    onClick={() => setMobileOpen(false)}
                  >
                    {t(link.tKey)}
                  </Link>
                );
              })}
              {NAV_GROUPS.map((group) => (
                <div key={group.tKey} className="pt-1">
                  <p className="px-3 pb-1 font-data text-[10px] uppercase tracking-[0.25em] text-[var(--gold)]/60">
                    {t(group.tKey)}
                  </p>
                  {group.items.map((item) => {
                    const active = isActiveLink(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        aria-current={active ? "page" : undefined}
                        className={`block rounded-lg py-2 px-3 text-sm transition-colors ${
                          active
                            ? "bg-[var(--bg-elevated)] text-[var(--gold-bright)] border-l-2 border-[var(--gold)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)]"
                        }`}
                        onClick={() => setMobileOpen(false)}
                      >
                        {t(item.tKey)}
                      </Link>
                    );
                  })}
                </div>
              ))}
              {/* Lang switcher (full width on mobile) */}
              <div className="pt-2 pb-1 flex justify-center">
                <LangSwitcher variant="full" />
              </div>
              <div className="pt-2 flex gap-2">
                <Link
                  href="/login"
                  className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#5865F2] py-2.5 text-sm font-medium text-white"
                  onClick={() => setMobileOpen(false)}
                >
                  <DiscordIcon className="h-4 w-4" />
                  Discord
                </Link>
                <Link
                  href="/scroll"
                  className="scroll-wordmark flex-1 items-center justify-center py-1"
                  aria-label={t("nav.cta_scroll_kills")}
                  onClick={() => setMobileOpen(false)}
                >
                  <ScrollWordmark label={t("nav.scroll")} />
                </Link>
              </div>
            </div>
          )}
        </div>
      </nav>
    </div>
  );
}

function DiscordIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
    </svg>
  );
}

/**
 * ScrollWordmark — le mot en lettrage varsity, effet sticker : gros
 * contour crème (découpe « collée »), contour navy, lettres or. Trois
 * couches de <text> empilées, paint-order stroke → les contours partent
 * vers l'extérieur, façon lettrage cousu.
 */
function ScrollWordmark({ label, large = false }: { label: string; large?: boolean }) {
  const word = label.toUpperCase();
  return (
    <svg
      viewBox="0 0 180 44"
      className={`scroll-wordmark-svg ${large ? "scroll-wordmark-svg--lg" : ""}`}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="scroll-wm-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F5E7C4" />
          <stop offset="0.45" stopColor="#DcbC7d" />
          <stop offset="0.55" stopColor="#C8AA6E" />
          <stop offset="1" stopColor="#96702f" />
        </linearGradient>
      </defs>
      {/* couche 1 — gros contour crème, la découpe sticker */}
      <text x="90" y="33" textAnchor="middle" className="scroll-wordmark-text" stroke="#F0E6D2" strokeWidth="9" strokeLinejoin="round" fill="none">
        {word}
      </text>
      {/* couche 2 — contour navy épais */}
      <text x="90" y="33" textAnchor="middle" className="scroll-wordmark-text" stroke="#0A1428" strokeWidth="4.5" strokeLinejoin="round" fill="none">
        {word}
      </text>
      {/* couche 3 — lettres or */}
      <text x="90" y="33" textAnchor="middle" className="scroll-wordmark-text" fill="url(#scroll-wm-gold)" stroke="#55401d" strokeWidth="0.75">
        {word}
      </text>
    </svg>
  );
}

/**
 * KCPennantStatic — étendard héraldique accroché sous un coin de la barre :
 * bannière navy, gros liseré or, vrai logo Karmine Corp teinté or (filtre
 * feFlood/feComposite sur le PNG officiel). Fallback instantané du tissu
 * 3D — et version définitive sur mobile / reduced-motion / no-WebGL.
 */
function KCPennantStatic({ side }: { side: "left" | "right" }) {
  const gradId = `kc-pennant-gold-${side}`;
  const goldizeId = `kc-pennant-goldize-${side}`;
  return (
    <svg
      aria-hidden
      className="kc-pennant-static"
      viewBox="0 0 58 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="58" y2="150">
          <stop stopColor="#E8D6A8" />
          <stop offset="0.5" stopColor="#C8AA6E" />
          <stop offset="1" stopColor="#785A28" />
        </linearGradient>
        <linearGradient id={`${gradId}-blue`} x1="0" y1="0" x2="58" y2="150">
          <stop stopColor="#0a63ff" />
          <stop offset="0.5" stopColor="#0047d1" />
          <stop offset="1" stopColor="#012372" />
        </linearGradient>
        {/* Recolore le logo (blanc → or) via son canal alpha. */}
        <filter id={goldizeId} x="-20%" y="-20%" width="140%" height="140%">
          <feFlood floodColor="#C8AA6E" result="gold" />
          <feComposite in="gold" in2="SourceAlpha" operator="in" />
        </filter>
      </defs>
      {/* tringle d'accroche */}
      <rect x="0" y="0" width="58" height="6" rx="3" fill={`url(#${gradId})`} />
      {/* corps bleu KC, queue d'aronde */}
      <path
        d="M4 6 H54 V138 L29 122 L4 138 Z"
        fill={`url(#${gradId}-blue)`}
        stroke={`url(#${gradId})`}
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      {/* liseré crème interne */}
      <path
        d="M9 12 H49 V128 L29 115.4 L9 128 Z"
        stroke="#F0E6D2"
        strokeOpacity="0.35"
        strokeWidth="1"
        fill="none"
      />
      {/* vrai logo KC, teinté or — au tiers bas */}
      <image
        href="/images/kc-logo.png"
        x="11"
        y="58"
        width="36"
        height="36"
        filter={`url(#${goldizeId})`}
      />
      {/* pointes de la queue d'aronde rehaussées */}
      <circle cx="4" cy="138" r="2" fill="#E8D6A8" />
      <circle cx="54" cy="138" r="2" fill="#E8D6A8" />
    </svg>
  );
}

function KCKILLSLogo() {
  return (
    <svg
      width="34"
      height="34"
      viewBox="0 0 34 34"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="transition-transform group-hover:scale-105"
      aria-label="KCKILLS logo"
    >
      {/* Hextech hexagonal mark (crystalline LoL vibe) */}
      <defs>
        <linearGradient id="kckills-logo-gradient" x1="0" y1="0" x2="34" y2="34">
          <stop stopColor="#F0E6D2" />
          <stop offset="0.5" stopColor="#C8AA6E" />
          <stop offset="1" stopColor="#785A28" />
        </linearGradient>
        <filter id="kckills-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="1" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Hexagonal outer frame */}
      <path
        d="M17 2 L30 9 L30 25 L17 32 L4 25 L4 9 Z"
        fill="url(#kckills-logo-gradient)"
      />
      {/* Inner dark cutout */}
      <path
        d="M17 5 L27 10.5 L27 23.5 L17 29 L7 23.5 L7 10.5 Z"
        fill="#010A13"
      />

      {/* KC monogram — bold, crisp */}
      <g filter="url(#kckills-glow)">
        {/* K */}
        <path
          d="M10 10 L12.5 10 L12.5 15.5 L16 10 L18.8 10 L14.6 16 L18.8 24 L16 24 L12.7 18 L12.5 18.3 L12.5 24 L10 24 Z"
          fill="#C8AA6E"
        />
        {/* C */}
        <path
          d="M24 12 Q24 10 22 10 L20.5 10 Q18.5 10 18.5 12 L18.5 22 Q18.5 24 20.5 24 L22 24 Q24 24 24 22 L24 20.5 L22 20.5 L22 21.5 Q22 22 21.5 22 L21 22 Q20.5 22 20.5 21.5 L20.5 12.5 Q20.5 12 21 12 L21.5 12 Q22 12 22 12.5 L22 13.5 L24 13.5 Z"
          fill="#C8AA6E"
        />
      </g>

      {/* Gold accent corner */}
      <circle cx="30" cy="9" r="1.5" fill="#F0E6D2" />
      <circle cx="4" cy="25" r="1.5" fill="#F0E6D2" />
    </svg>
  );
}
