"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AdminBreadcrumbs, type AdminCrumb } from "./AdminBreadcrumbs";

interface Props {
  /** Page title — rendered as <h1>. */
  title: ReactNode;
  /** Optional one-line subtitle below the title. */
  subtitle?: ReactNode;
  /** Explicit breadcrumb trail. Omit to derive from pathname. */
  breadcrumbs?: AdminCrumb[];
  /** Hide the breadcrumbs entirely. */
  hideBreadcrumbs?: boolean;
  /** Right-aligned slot in the header — buttons, dropdowns, refresh. */
  actions?: ReactNode;
  /**
   * "Last updated" / freshness label. Rendered as a subtle line under
   * the actions (e.g. "Mis à jour il y a 2 min"). Pass a string OR a
   * pre-formatted node (e.g. with a tooltip).
   */
  freshness?: ReactNode;
  /**
   * Optional secondary nav slot (chips / tabs) just below the header.
   * Rendered above `children` and not affected by header collapse.
   */
  toolbar?: ReactNode;
  /** Page content. */
  children: ReactNode;
  /** Tighter vertical spacing between header and content. */
  dense?: boolean;
  /** Disable the auto-collapse-on-scroll header behaviour. */
  disableCollapse?: boolean;
  className?: string;
}

/**
 * AdminPage — top-level wrapper for every admin page.
 *
 * Standardises:
 *   - Breadcrumbs (auto from pathname or explicit)
 *   - Title + subtitle + actions in a single header row
 *   - Optional freshness timestamp (live data pages)
 *   - Optional toolbar slot (chips, tabs, search)
 *   - Vertical rhythm (space-y-* between header / toolbar / children)
 *   - Mobile: header shrinks on scroll past 80px (more vertical room)
 *
 * Wrap the content of every /admin/<page>/page.tsx with this — even
 * pages that only have one section, so navigation feels uniform.
 */
export function AdminPage({
  title,
  subtitle,
  breadcrumbs,
  hideBreadcrumbs = false,
  actions,
  freshness,
  toolbar,
  children,
  dense = false,
  disableCollapse = false,
  className = "",
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (disableCollapse) return;
    const onScroll = () => {
      const y = window.scrollY;
      setCollapsed(y > 80);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [disableCollapse]);

  return (
    <div className={`${dense ? "space-y-4" : "space-y-6"} ${className}`}>
      <header className="space-y-2">
        {!hideBreadcrumbs ? <AdminBreadcrumbs items={breadcrumbs} /> : null}

        <div
          className={`flex items-end justify-between gap-4 flex-wrap transition-all ${
            collapsed ? "md:gap-2" : ""
          }`}
        >
          <div className="min-w-0 flex-1">
            <h1
              className={`font-display font-black uppercase tracking-tight text-[var(--gold)] transition-all ${
                collapsed ? "text-xl md:text-2xl" : "text-2xl md:text-3xl"
              }`}
            >
              {title}
            </h1>
            {subtitle && !collapsed ? (
              <p className="text-sm text-[var(--text-muted)] mt-1">{subtitle}</p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            {actions ? (
              <div className="flex flex-wrap items-center gap-2 justify-end">{actions}</div>
            ) : null}
            {freshness && !collapsed ? (
              <p className="text-[10px] text-[var(--text-muted)] font-mono">
                Mis à jour {typeof freshness === "string" ? freshness : freshness}
              </p>
            ) : null}
          </div>
        </div>

        {toolbar ? <div className="pt-1">{toolbar}</div> : null}
      </header>

      <div>{children}</div>
    </div>
  );
}
