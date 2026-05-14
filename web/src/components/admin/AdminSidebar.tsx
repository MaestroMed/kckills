"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AdminEnvBadge } from "./AdminEnvBadge";

/**
 * AdminSidebar — left rail of the admin layout.
 *
 * Now lives inside a flex container (the parent layout owns a 260px
 * column), so we no longer use `fixed` positioning. Sticks to the
 * viewport with `sticky top-0 h-screen` and scrolls internally when
 * content overflows.
 *
 * Features :
 *   - Grouped sections (Overview / Content / Moderation / Pipeline /
 *     Data / Lab) with collapsible headers persisted in localStorage
 *   - Active route highlight (`--gold` left border + bg tint + aria-current)
 *   - Collapsed mode (icon-only) toggle persisted in cookie so SSR
 *     respects it on next load — but bootstrap value is read from
 *     localStorage to keep the toggle responsive
 *   - Footer : env badge + version + back-to-public link + logout
 *   - Mobile : caller passes `mobileVariant` to render the drawer body
 *     without the sticky/desktop shell (used by AdminMobileNav)
 */

interface NavItem {
  href: string;
  label: string;
  icon: string;
  badge?: string;
}

interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    id: "overview",
    label: "Overview",
    items: [{ href: "/admin", label: "Dashboard", icon: "▣" }],
  },
  {
    id: "content",
    label: "Content",
    items: [
      { href: "/admin/clips", label: "Clip Library", icon: "▶" },
      { href: "/admin/editorial", label: "Editorial", icon: "✦" },
      { href: "/admin/featured", label: "Featured du jour", icon: "★" },
      { href: "/admin/playlists", label: "Wolf player vibes", icon: "♬" },
      { href: "/admin/hero-videos", label: "Hero videos", icon: "🎬" },
      { href: "/admin/bgm", label: "BGM (legacy /scroll)", icon: "♪" },
      { href: "/admin/push", label: "Push Broadcast", icon: "✉" },
    ],
  },
  {
    id: "moderation",
    label: "Moderation",
    items: [
      { href: "/admin/moderation", label: "Comments", icon: "✎" },
      { href: "/admin/moderation/reports", label: "Reports", icon: "⚠" },
    ],
  },
  {
    // Wave 31a — Community & Events hub for the Wave-30 features.
    // Bracket tournaments, face-off duels, compilations, quote moderation,
    // achievements, BCC interactions. The /admin/community page is a
    // dashboard with stats + deep-links to per-table editors.
    id: "community",
    label: "Community & Events",
    items: [
      { href: "/admin/community", label: "Hub", icon: "✦" },
      { href: "/admin/community/bracket", label: "Bracket", icon: "▦" },
      { href: "/admin/community/face-off", label: "Face-off", icon: "⚔" },
      { href: "/admin/community/compilations", label: "Compilations", icon: "▸" },
      { href: "/admin/community/quotes", label: "Quotes", icon: "❝" },
      { href: "/admin/community/achievements", label: "Achievements", icon: "🏆" },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    items: [
      { href: "/admin/pipeline", label: "Daemon Status", icon: "◉" },
      { href: "/admin/pipeline/jobs", label: "Job Queue", icon: "⚙" },
      { href: "/admin/pipeline/trigger", label: "Trigger Run", icon: "⚡" },
      { href: "/admin/pipeline/run", label: "Manual Run", icon: "▶" },
      { href: "/admin/pipeline/dlq", label: "Dead Letter", icon: "☠" },
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      { href: "/admin/roster", label: "Roster", icon: "●" },
      { href: "/admin/analytics", label: "Analytics", icon: "▲" },
      { href: "/admin/audit", label: "Audit Log", icon: "◎" },
      { href: "/admin/perf", label: "Web Vitals", icon: "♡" },
    ],
  },
  {
    id: "lab",
    label: "Lab",
    items: [{ href: "/admin/lab", label: "Experiments", icon: "⚗" }],
  },
];

const STORAGE_GROUPS = "kc-admin-sidebar-collapsed";
const STORAGE_RAIL = "kc-admin-sidebar-rail-collapsed";
const COOKIE_RAIL = "kc_admin_sidebar_collapsed";

interface AdminSidebarProps {
  /** When true, renders the inner content for the mobile drawer (no
   *  sticky shell, no rail-collapse toggle). */
  mobileVariant?: boolean;
  /** Callback for the mobile drawer to close itself when a link is
   *  clicked. Ignored in desktop mode. */
  onNavigate?: () => void;
}

export function AdminSidebar({ mobileVariant = false, onNavigate }: AdminSidebarProps = {}) {
  const pathname = usePathname();
  const [groupsCollapsed, setGroupsCollapsed] = useState<Set<string>>(new Set());
  const [railCollapsed, setRailCollapsed] = useState(false);

  // Restore collapsed state on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_GROUPS);
      if (raw) setGroupsCollapsed(new Set(JSON.parse(raw)));
    } catch {
      /* private mode — ignore */
    }
    try {
      const rail = localStorage.getItem(STORAGE_RAIL);
      if (rail === "1") setRailCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setGroupsCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STORAGE_GROUPS, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleRail = useCallback(() => {
    setRailCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(STORAGE_RAIL, next ? "1" : "0");
        // Cookie so the parent layout (server) could pick this up on next render
        document.cookie = `${COOKIE_RAIL}=${next ? "1" : "0"}; path=/; max-age=${60 * 60 * 24 * 365}`;
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const isActive = useCallback(
    (href: string) => {
      if (href === "/admin") return pathname === "/admin";
      return pathname === href || pathname.startsWith(href + "/");
    },
    [pathname],
  );

  const collapsed = !mobileVariant && railCollapsed;

  // Inner content (used by both desktop sidebar and mobile drawer)
  const body = (
    <>
      {/* Logo / brand */}
      <Link
        href="/admin"
        onClick={onNavigate}
        className="flex items-center justify-between gap-2 px-4 py-4 border-b border-[var(--border-gold)] hover:bg-[var(--bg-elevated)]/50 transition-colors"
      >
        <span className="font-display text-sm font-black tracking-widest text-[var(--gold)]">
          {collapsed ? (
            "KC"
          ) : (
            <>
              KC<span className="text-[var(--gold-bright)]">ADMIN</span>
            </>
          )}
        </span>
        {!mobileVariant && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              toggleRail();
            }}
            aria-label={collapsed ? "Étendre la barre latérale" : "Réduire la barre latérale"}
            className="text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)] px-1"
          >
            {collapsed ? "»" : "«"}
          </button>
        )}
      </Link>

      {/* Nav groups */}
      <nav className="px-2 py-3 space-y-1 flex-1 overflow-y-auto">
        {NAV.map((group) => {
          const isGroupCollapsed = groupsCollapsed.has(group.id);
          return (
            <div key={group.id} className="mb-2">
              {!collapsed && (
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
                  aria-expanded={!isGroupCollapsed}
                >
                  <span>{group.label}</span>
                  <span className="text-[8px] opacity-60" aria-hidden="true">
                    {isGroupCollapsed ? "▸" : "▾"}
                  </span>
                </button>
              )}
              {(collapsed || !isGroupCollapsed) && (
                <div className="mt-1 space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? "page" : undefined}
                        title={collapsed ? item.label : undefined}
                        className={`relative flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                          active
                            ? "bg-[var(--gold)]/15 text-[var(--gold)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                        } ${collapsed ? "justify-center" : ""}`}
                      >
                        {active && (
                          <span
                            aria-hidden="true"
                            className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r bg-[var(--gold)]"
                          />
                        )}
                        <span className="text-sm opacity-80 w-4 text-center" aria-hidden="true">
                          {item.icon}
                        </span>
                        {!collapsed && (
                          <>
                            <span className="flex-1">{item.label}</span>
                            {item.badge && (
                              <span className="rounded-full bg-[var(--red)] text-white text-[9px] px-1.5 py-0.5">
                                {item.badge}
                              </span>
                            )}
                          </>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-[var(--border-gold)] bg-[var(--bg-surface)] p-3 space-y-2">
        {!collapsed && (
          <div className="flex items-center justify-between gap-2">
            <AdminEnvBadge size="xs" />
            <span className="font-data text-[9px] text-[var(--text-disabled)]" title="Version">
              v{process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0"}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
          <Link
            href="/"
            onClick={onNavigate}
            className="flex-1 hover:text-[var(--gold)] truncate"
            title="Retour au site public"
          >
            {collapsed ? "←" : "← Site public"}
          </Link>
          <Link
            href="/admin/login?logout=1"
            onClick={onNavigate}
            className="rounded border border-[var(--border-gold)] px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-[var(--text-muted)] hover:border-[var(--red)]/40 hover:text-[var(--red)]"
            title="Se déconnecter"
          >
            {collapsed ? "✕" : "Logout"}
          </Link>
        </div>
      </div>
    </>
  );

  if (mobileVariant) {
    return (
      <div className="flex flex-col h-full bg-[var(--bg-surface)]">{body}</div>
    );
  }

  return (
    <aside
      aria-label="Navigation admin"
      className={`hidden md:flex sticky top-0 h-screen border-r border-[var(--border-gold)] bg-[var(--bg-surface)] z-40 flex-col ${
        collapsed ? "w-14" : "w-[260px]"
      } transition-[width] duration-150`}
    >
      {body}
    </aside>
  );
}
