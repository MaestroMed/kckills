"use client";

/**
 * LeagueNav — horizontal chip strip in the navbar for swapping leagues.
 *
 * Layout :
 *   [ All ] [ LEC ] [ LCS ] [ LCK ] [ LPL ] [ LFL ] [ ▾ Plus ]
 *
 *   * "All"  → /  (KC home, default)
 *   * Each league chip → /league/{slug}
 *   * "Plus" chip opens the <TeamSelector /> bottom-sheet so users can
 *     jump directly to a team page without going through a league hub.
 *
 * Visibility :
 *   * Renders ONLY when `NEXT_PUBLIC_LOLTOK_PUBLIC=true`. In KC pilot
 *     mode the chip strip is hidden — Navbar continues to look like
 *     today's homepage. The component itself returns null in that case
 *     so SSR + client agree on the same DOM.
 *
 * Mobile :
 *   * `overflow-x-auto` + `snap-x` momentum scroll
 *   * Each chip is `snap-start` so the active chip pins under the user's
 *     finger when they tap-and-release.
 *   * Active chip has `bg-[var(--gold)]` fill so it stays obvious during
 *     a fast horizontal flick.
 *
 * The component lazily fetches `/api/leagues` on mount. The 5-min cache
 * on the route + the React-cache on the loader means at most one fetch
 * per visitor session.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { TeamSelector } from "../team/TeamSelector";

interface WireLeague {
  slug: string;
  name: string;
  short_name: string;
  region: string;
  priority: number;
}

interface LeaguesApiResponse {
  leagues: WireLeague[];
  count: number;
  mode: "kc_pilot" | "loltok";
}

export interface LeagueNavProps {
  /** Compile-time visibility — passed by the parent so the component
   *  only ever mounts when the env says LoLTok mode is on. We accept
   *  it as a prop (instead of reading the env here) so the server-
   *  rendered Navbar can decide once and skip mounting entirely in
   *  KC pilot mode. */
  enabled: boolean;
}

export function LeagueNav({ enabled }: LeagueNavProps) {
  const pathname = usePathname();
  const [leagues, setLeagues] = useState<WireLeague[] | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/leagues", { headers: { Accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((data: LeaguesApiResponse) => {
        if (cancelled) return;
        setLeagues(Array.isArray(data?.leagues) ? data.leagues : []);
      })
      .catch((err) => {
        console.warn("[LeagueNav] /api/leagues fetch failed:", err);
        if (!cancelled) setLeagues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  // Derive the active chip from the current pathname so the highlight
  // updates on client navigation without an extra round-trip.
  const activeSlug = useMemo<string | null>(() => {
    if (!pathname) return null;
    if (pathname === "/" || pathname.startsWith("/scroll")) return "all";
    const m = pathname.match(/^\/league\/([^/]+)/);
    return m ? m[1] : null;
  }, [pathname]);

  if (!enabled) return null;

  // While loading we render the "All" chip plus a placeholder spacer
  // so the navbar height doesn't jump when the chip strip pops in.
  const items: WireLeague[] = leagues ?? [];

  return (
    <div
      role="navigation"
      aria-label="Ligues"
      className="border-t border-[var(--border-gold)]/40 bg-[var(--bg-primary)]/40 backdrop-blur-sm"
    >
      <div className="mx-auto max-w-7xl px-2 py-2">
        <ul className="flex items-center gap-2 overflow-x-auto snap-x snap-mandatory scrollbar-none [-webkit-overflow-scrolling:touch]">
          <li className="snap-start flex-shrink-0">
            <ChipLink href="/" active={activeSlug === "all"} label="Toutes" subtitle="Karmine Corp" />
          </li>
          {items.map((l) => (
            <li key={l.slug} className="snap-start flex-shrink-0">
              <ChipLink
                href={`/league/${l.slug}`}
                active={activeSlug === l.slug}
                label={l.short_name}
                subtitle={l.region}
              />
            </li>
          ))}
          <li className="snap-start flex-shrink-0 ml-1">
            <TeamSelector triggerLabel="Plus" />
          </li>
        </ul>
      </div>
    </div>
  );
}

interface ChipLinkProps {
  href: string;
  active: boolean;
  label: string;
  subtitle?: string;
}

function ChipLink({ href, active, label, subtitle }: ChipLinkProps) {
  const baseClass =
    "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium border transition-colors whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold)]";
  const stateClass = active
    ? "bg-[var(--gold)] border-[var(--gold)] text-[var(--bg-primary)]"
    : "border-[var(--border-gold)] text-[var(--text-secondary)] hover:text-[var(--gold)] hover:border-[var(--gold)]/40";
  return (
    <Link href={href} className={`${baseClass} ${stateClass}`} aria-current={active ? "page" : undefined}>
      <span className="font-display font-bold tracking-wider">{label}</span>
      {subtitle ? (
        <span className={`text-[10px] ${active ? "text-[var(--bg-primary)]/70" : "text-[var(--text-muted)]"}`}>
          {subtitle}
        </span>
      ) : null}
    </Link>
  );
}
