"use client";

/**
 * dynamic-imports.ts — centralized lazy-load helpers (PR-loltok DF).
 *
 * Wave 11 / Agent DF / bundle-audit-2026-04 :
 *   The /scroll first-load JS sits at ~1.7 MB on mobile (Agent AE perf
 *   audit, 2026-04-25). Big chunks of that come from admin-only code
 *   that bleeds into the public bundle because the route handlers
 *   import client components synchronously.
 *
 *   This module exposes pre-baked `next/dynamic` wrappers for the
 *   heaviest admin client components.
 *
 *   Consumer-side benefits :
 *     • SSR is disabled for admin client trees — admins are < 10% of
 *       traffic, so we trade a 50 ms FOC against not shipping the code
 *       to public visitors at all.
 *     • Centralized list = easier to spot fresh bloat in code review.
 *
 * The shared <AdminLoadingSkeleton> JSX placeholder lives in
 * `dynamic-imports-skeleton.tsx` (must be a .tsx file because of JSX).
 *
 * Use only for client components that :
 *   1. Live under /admin/* (not on the public critical path)
 *   2. Are heavier than ~5 KB after gzip
 *   3. Are below the immediate first paint (or are gated behind admin
 *      auth so the server-rendered shell paints instantly with the
 *      gold border + sidebar before the React tree mounts).
 */
import dynamic from "next/dynamic";
import { AdminLoadingSkeleton } from "./dynamic-imports-skeleton";

// Re-export the skeleton so callers don't have to import two files when
// they want to render their own placeholder of the same flavor.
export { AdminLoadingSkeleton };

// ─── Lazy-loaded admin children ───────────────────────────────────────
// Each wrapper :
//   1. Defers the actual chunk fetch until the wrapper renders.
//   2. Disables SSR (admin pages are `force-dynamic` server-side already
//      and we don't want to ship the code in the SSR HTML payload).
//   3. Renders the AdminLoadingSkeleton at a sensible height.
//
// Naming convention : `Lazy<Component>` so it's clear at the call site
// that the wrapper does extra work vs. the eager import.
//
// We rely on `next/dynamic`'s built-in inference rather than a generic
// helper — the helper would erase the prop signature and force `any`
// at every call site. Each lazy wrapper is therefore explicit, but
// trivially short.

/** /admin/clips — 432-line filterable library with bulk-action bar. */
export const LazyClipsLibrary = dynamic(
  () => import("@/app/admin/clips/clips-library").then((m) => m.ClipsLibrary),
  {
    ssr: false,
    loading: () => (
      AdminLoadingSkeleton({ height: 600, label: "Chargement de la bibliothèque clips…" })
    ),
  }
);

/** /admin/moderation — 199-line live queue with Haiku decisions. */
export const LazyModerationQueue = dynamic(
  () => import("@/app/admin/moderation/moderation-queue").then((m) => m.ModerationQueue),
  {
    ssr: false,
    loading: () => (
      AdminLoadingSkeleton({ height: 500, label: "Chargement de la file de modération…" })
    ),
  }
);

/** /admin/featured — 219-line picker with calendar + top-50 grid. */
export const LazyFeaturedPicker = dynamic(
  () => import("@/app/admin/featured/featured-picker").then((m) => m.FeaturedPicker),
  {
    ssr: false,
    loading: () => (
      AdminLoadingSkeleton({ height: 600, label: "Chargement du picker featured…" })
    ),
  }
);

/** /admin/editorial — 178-line drag-rank board. */
export const LazyEditorialBoard = dynamic(
  () => import("@/app/admin/editorial/editorial-board").then((m) => m.EditorialBoard),
  {
    ssr: false,
    loading: () => (
      AdminLoadingSkeleton({ height: 500, label: "Chargement du board éditorial…" })
    ),
  }
);

/** /admin/roster — 165-line per-player editor with KDA snapshots. */
export const LazyRosterEditor = dynamic(
  () => import("@/app/admin/roster/roster-editor").then((m) => m.RosterEditor),
  {
    ssr: false,
    loading: () => (
      AdminLoadingSkeleton({ height: 500, label: "Chargement de l'éditeur roster…" })
    ),
  }
);
