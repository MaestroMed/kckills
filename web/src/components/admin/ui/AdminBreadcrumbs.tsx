"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface AdminCrumb {
  label: string;
  href?: string;
}

interface Props {
  /**
   * Explicit crumb list. If omitted, the trail is auto-derived from the
   * current pathname using `SEGMENT_LABELS` for friendly names.
   */
  items?: AdminCrumb[];
  className?: string;
}

/**
 * Friendly labels for known admin path segments. Anything not in this
 * dict falls back to a Capitalised version of the raw segment.
 */
const SEGMENT_LABELS: Record<string, string> = {
  admin: "Admin",
  pipeline: "Pipeline",
  jobs: "Job Queue",
  dlq: "Dead Letter Queue",
  trigger: "Trigger Run",
  run: "Run",
  clips: "Clip Library",
  editorial: "Éditorial",
  featured: "Featured du jour",
  playlists: "Playlists",
  bgm: "BGM",
  push: "Push Broadcast",
  moderation: "Modération",
  reports: "Signalements",
  "community-clips": "Community Clips",
  roster: "Roster",
  analytics: "Analytics",
  audit: "Audit Log",
  perf: "Performance",
  lab: "Lab",
};

function prettifySegment(seg: string): string {
  if (SEGMENT_LABELS[seg]) return SEGMENT_LABELS[seg];
  // Fallback: kebab-case → "Title Case"
  return seg
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

function deriveFromPath(pathname: string): AdminCrumb[] {
  const parts = pathname.split("/").filter(Boolean);
  // Always start at /admin → "Admin"
  const crumbs: AdminCrumb[] = [];
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    acc += "/" + parts[i];
    const isLast = i === parts.length - 1;
    crumbs.push({
      label: prettifySegment(parts[i]),
      href: isLast ? undefined : acc,
    });
  }
  return crumbs;
}

/**
 * AdminBreadcrumbs — chevron-separated trail.
 *
 * Pass `items` for explicit control, or omit and let it derive from
 * `usePathname()`. The last crumb never gets a link (current page).
 *
 * Renders nothing if there's only one crumb (no value at /admin root).
 */
export function AdminBreadcrumbs({ items, className = "" }: Props) {
  const pathname = usePathname() ?? "/admin";
  const crumbs = items ?? deriveFromPath(pathname);

  if (crumbs.length <= 1) return null;

  return (
    <nav
      aria-label="Fil d'Ariane"
      className={`flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] ${className}`}
    >
      {crumbs.map((c, i) => {
        const isLast = i === crumbs.length - 1;
        return (
          <span key={`${c.label}-${i}`} className="flex items-center gap-1.5">
            {c.href && !isLast ? (
              <Link
                href={c.href}
                className="rounded px-1 -mx-1 hover:text-[var(--gold)] transition-colors"
              >
                {c.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                className={isLast ? "text-[var(--text-secondary)] font-semibold" : ""}
              >
                {c.label}
              </span>
            )}
            {!isLast && (
              <span aria-hidden="true" className="text-[var(--gold)]/30">
                ›
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
