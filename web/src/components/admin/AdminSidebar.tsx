"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useEffect } from "react";

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
    items: [
      { href: "/admin", label: "Dashboard", icon: "▣" },
    ],
  },
  {
    id: "content",
    label: "Content",
    items: [
      { href: "/admin/clips", label: "Clip Library", icon: "▶" },
      { href: "/admin/editorial", label: "Editorial", icon: "✦" },
      { href: "/admin/featured", label: "Featured du jour", icon: "★" },
      { href: "/admin/bgm", label: "BGM Playlist", icon: "♪" },
      { href: "/admin/push", label: "Push Broadcast", icon: "📣" },
    ],
  },
  {
    id: "moderation",
    label: "Moderation",
    items: [
      { href: "/admin/moderation", label: "Comments", icon: "✎" },
      { href: "/admin/moderation/reports", label: "Reports", icon: "⚠" },
      { href: "/admin/moderation/community-clips", label: "Community Clips", icon: "⊕" },
    ],
  },
  {
    id: "pipeline",
    label: "Pipeline",
    items: [
      { href: "/admin/pipeline", label: "Daemon Status", icon: "◉" },
      { href: "/admin/pipeline/jobs", label: "Job Queue", icon: "⚙" },
      { href: "/admin/pipeline/trigger", label: "Trigger Run", icon: "⚡" },
    ],
  },
  {
    id: "data",
    label: "Data",
    items: [
      { href: "/admin/roster", label: "Roster", icon: "●" },
      { href: "/admin/analytics", label: "Analytics", icon: "▲" },
      { href: "/admin/audit", label: "Audit Log", icon: "◎" },
    ],
  },
];

const STORAGE_KEY = "kc-admin-sidebar-collapsed";

export function AdminSidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Restore collapsed state from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setCollapsed(new Set(JSON.parse(raw)));
    } catch {}
  }, []);

  const toggleGroup = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const isActive = (href: string) => {
    if (href === "/admin") return pathname === "/admin";
    return pathname.startsWith(href);
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 border-r border-[var(--border-gold)] bg-[var(--bg-surface)] overflow-y-auto z-40">
      {/* Logo */}
      <Link
        href="/admin"
        className="flex items-center gap-2 px-4 py-4 border-b border-[var(--border-gold)] hover:bg-[var(--bg-elevated)]/50 transition-colors"
      >
        <span className="font-display text-sm font-black tracking-widest text-[var(--gold)]">
          KC<span className="text-[var(--gold-bright)]">ADMIN</span>
        </span>
      </Link>

      {/* Nav groups */}
      <nav className="px-2 py-3 space-y-1">
        {NAV.map((group) => {
          const isCollapsed = collapsed.has(group.id);
          return (
            <div key={group.id} className="mb-2">
              <button
                onClick={() => toggleGroup(group.id)}
                className="w-full flex items-center justify-between px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              >
                <span>{group.label}</span>
                <span className="text-[8px] opacity-60">{isCollapsed ? "▸" : "▾"}</span>
              </button>
              {!isCollapsed && (
                <div className="mt-1 space-y-0.5">
                  {group.items.map((item) => {
                    const active = isActive(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs transition-colors ${
                          active
                            ? "bg-[var(--gold)]/15 text-[var(--gold)] border border-[var(--gold)]/30"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)]"
                        }`}
                      >
                        <span className="text-sm opacity-80 w-4 text-center">{item.icon}</span>
                        <span className="flex-1">{item.label}</span>
                        {item.badge && (
                          <span className="rounded-full bg-[var(--red)] text-white text-[9px] px-1.5 py-0.5">
                            {item.badge}
                          </span>
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
      <div className="absolute bottom-0 left-0 right-0 border-t border-[var(--border-gold)] bg-[var(--bg-surface)] p-3">
        <Link
          href="/"
          className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] hover:text-[var(--gold)]"
        >
          <span>←</span>
          <span>Back to public site</span>
        </Link>
      </div>
    </aside>
  );
}
