"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { AdminGlobalSearch } from "./AdminGlobalSearch";
import { AdminQuickActionsButton } from "./AdminQuickActions";
import { AdminMobileNavTrigger } from "./AdminMobileNav";
import { AdminEnvBadge } from "./AdminEnvBadge";
import { HeartbeatPill } from "./HeartbeatPill";

/**
 * AdminTopbar — sticky 56px (48px mobile) top bar of the admin layout.
 *
 * Layout (desktop) :
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │ [☰] crumb / crumb / page    [search]    [⌘K] [env] [♥]          │
 *   └──────────────────────────────────────────────────────────────────┘
 *
 * Sticky with `backdrop-blur-md` so scrolling content remains slightly
 * visible behind the bar — matches the Linear/Vercel admin aesthetic.
 *
 * Breadcrumbs are auto-derived from the URL path. Each segment becomes
 * a clickable crumb. The mapping table at the top of the file gives
 * pretty labels for known segments ; unknown segments get the raw text.
 */

const SEGMENT_LABELS: Record<string, string> = {
  admin: "Admin",
  clips: "Clips",
  editorial: "Editorial",
  featured: "Featured",
  playlists: "Playlists",
  bgm: "BGM",
  push: "Push",
  moderation: "Modération",
  reports: "Reports",
  pipeline: "Pipeline",
  jobs: "Jobs",
  trigger: "Trigger",
  run: "Run",
  dlq: "DLQ",
  roster: "Roster",
  analytics: "Analytics",
  audit: "Audit",
  perf: "Web Vitals",
  lab: "Lab",
  search: "Recherche",
};

interface Crumb {
  label: string;
  href: string;
}

function buildCrumbs(pathname: string): Crumb[] {
  const parts = pathname.split("/").filter(Boolean);
  // Always start with /admin even if we're at /admin/foo
  const crumbs: Crumb[] = [];
  let acc = "";
  for (const p of parts) {
    acc += `/${p}`;
    // Heuristic : if the segment looks like a UUID or numeric ID,
    // shorten it instead of showing the raw value
    let label: string;
    if (SEGMENT_LABELS[p]) {
      label = SEGMENT_LABELS[p];
    } else if (/^[a-f0-9-]{8,}$/i.test(p)) {
      label = p.slice(0, 8) + "…";
    } else {
      label = p;
    }
    crumbs.push({ label, href: acc });
  }
  return crumbs;
}

export function AdminTopbar() {
  const pathname = usePathname();
  const crumbs = useMemo(() => buildCrumbs(pathname), [pathname]);

  return (
    <header
      className="sticky top-0 z-30 h-12 md:h-14 border-b border-[var(--border-gold)] bg-[var(--bg-surface)]/80 backdrop-blur-md flex items-center gap-2 px-3 md:px-4"
    >
      {/* Left : hamburger (mobile) + breadcrumbs */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <AdminMobileNavTrigger />
        <nav
          aria-label="Fil d'Ariane"
          className="hidden sm:flex items-center gap-1 text-xs text-[var(--text-muted)] min-w-0 overflow-hidden"
        >
          {crumbs.map((c, i) => {
            const isLast = i === crumbs.length - 1;
            return (
              <span key={c.href} className="flex items-center gap-1 min-w-0">
                {i > 0 && (
                  <span aria-hidden="true" className="text-[var(--text-disabled)]">
                    /
                  </span>
                )}
                {isLast ? (
                  <span
                    aria-current="page"
                    className="font-display text-[var(--gold)] truncate"
                  >
                    {c.label}
                  </span>
                ) : (
                  <Link
                    href={c.href}
                    className="hover:text-[var(--text-secondary)] truncate"
                  >
                    {c.label}
                  </Link>
                )}
              </span>
            );
          })}
        </nav>
        {/* Mobile : show only the last crumb (page name) */}
        <span
          aria-current="page"
          className="sm:hidden font-display text-xs text-[var(--gold)] truncate"
        >
          {crumbs[crumbs.length - 1]?.label ?? "Admin"}
        </span>
      </div>

      {/* Center : global search */}
      <div className="flex items-center justify-center shrink-0">
        <AdminGlobalSearch />
      </div>

      {/* Right : quick actions + env + heartbeat */}
      <div className="flex items-center gap-2 shrink-0 ml-2">
        <AdminQuickActionsButton />
        <span className="hidden lg:inline">
          <AdminEnvBadge size="xs" />
        </span>
        <HeartbeatPill />
      </div>
    </header>
  );
}
