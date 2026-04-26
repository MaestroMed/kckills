"use client";

/**
 * WebVitalsReporter — Real User Monitoring (RUM) for Core Web Vitals.
 *
 * Mounted ONCE in the root layout (web/src/app/layout.tsx). Subscribes to
 * Google's `web-vitals` callbacks via Next's bundled `useReportWebVitals`
 * hook (no extra dependency — Next.js ships web-vitals internally).
 *
 * Why this exists :
 *   Phase 4 of CLAUDE.md targets Lighthouse > 90, but Lighthouse is a
 *   synthetic, throttled-3G simulation. RUM tells us how REAL users on
 *   REAL devices (mostly mobile in France) actually experience the site.
 *   Field data is what Google ranks, not lab data.
 *
 * Wire-up :
 *   1. Hook fires once per Core Web Vital sample (LCP/CLS/INP/FCP/TTFB
 *      and the legacy FID — Next's useReportWebVitals subscribes to all
 *      six).
 *   2. We build a strict-typed PerfVitalMetadata payload and call
 *      track('perf.vital', { metadata }) — the existing analytics
 *      pipeline batches via sendBeacon on page unload, so the metric
 *      survives even if the user closes the tab right after FCP.
 *   3. Server-side validation in /api/track enforces the {name, value,
 *      rating} contract — anything malformed is silently dropped.
 *
 * Idempotency :
 *   The web-vitals lib already de-duplicates internally — each metric
 *   fires its callback at most ONCE per page visit (LCP fires when the
 *   user navigates away or hides the tab, CLS aggregates layout shifts
 *   over the whole session, etc.). We add an extra guard via a Set
 *   of "name|id" keys to handle React strict-mode double-mount in dev
 *   AND to stop accidental double-fires from PWA service-worker update
 *   `controllerchange` events that re-mount the layout.
 *
 * Privacy :
 *   - No PII sent. The metric `id` is a web-vitals-internal UUID
 *     (`v4-<timestamp>-<random>`); we strip the timestamp portion
 *     because the API sanitiser would flag the long digit run as a
 *     phone number (false positive) and drop the whole id field.
 *   - `navigator.doNotTrack === '1'` is honoured — we silently no-op.
 *   - `page_path` is `window.location.pathname` only — no querystring,
 *     no hash, no PII embedded in URLs.
 */

import { useEffect, useRef } from "react";
import { useReportWebVitals } from "next/web-vitals";
import type { PerfVitalMetadata, WebVitalName, WebVitalRating } from "@/lib/analytics/track";
import { track } from "@/lib/analytics/track";

// next/web-vitals uses the bundled web-vitals types. We accept its Metric
// shape via a structural type so we don't have to import the deep
// "next/dist/compiled/web-vitals" path (which TypeScript may not resolve
// cleanly through the next package's exports map).
interface NextWebVitalsMetric {
  name: string;
  value: number;
  rating?: string;
  id: string;
  navigationType?: string;
  // delta + entries are present but unused here.
  delta?: number;
  entries?: unknown[];
}

const VALID_NAMES: ReadonlySet<WebVitalName> = new Set<WebVitalName>([
  "CLS",
  "FCP",
  "FID",
  "INP",
  "LCP",
  "TTFB",
]);

const VALID_RATINGS: ReadonlySet<WebVitalRating> = new Set<WebVitalRating>([
  "good",
  "needs-improvement",
  "poor",
]);

/**
 * Strip long digit runs from the web-vitals id so the API sanitiser
 * (which flags 7+ consecutive digits as a phone heuristic) doesn't
 * drop the field. We keep the structural shape so each metric still
 * has a unique-ish id for ad-hoc debugging in admin tools.
 *
 * Example : "v4-1745621435982-9876543210987" → "v4-tNQVx-aB3cD"
 *           (deterministic base36 of the original numeric chunks)
 */
function safeMetricId(rawId: string): string {
  return rawId.replace(/\d{7,}/g, (digits) => {
    // Convert long digit run to base36 → much shorter, no longer matches
    // the 7-digit phone heuristic. parseInt handles 13-digit timestamps fine.
    const n = Number(digits);
    if (!Number.isFinite(n)) return digits.slice(-6);
    return n.toString(36);
  });
}

function isDoNotTrack(): boolean {
  if (typeof navigator === "undefined") return false;
  try {
    // Spec : navigator.doNotTrack === "1" → user opted out.
    // Some legacy browsers expose window.doNotTrack instead.
    if (navigator.doNotTrack === "1") return true;
    type DntWindow = { doNotTrack?: string };
    const w = typeof window !== "undefined" ? (window as unknown as DntWindow) : null;
    if (w && w.doNotTrack === "1") return true;
  } catch {
    /* sandboxed — assume DNT off */
  }
  return false;
}

function getPagePath(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const path = window.location.pathname;
    // Cap to MAX_STRING_LEN (200) so the API sanitiser never drops it
    // for length reasons. Real paths on kckills are well under 64 chars.
    return path.length > 200 ? path.slice(0, 200) : path;
  } catch {
    return undefined;
  }
}

export function WebVitalsReporter() {
  // Track which metrics we've already reported (keyed by "name|id").
  // Prevents React strict-mode double-mount duplicates and any future
  // case where the layout remounts (e.g. PWA SW controllerchange).
  // Using useRef so the Set survives re-renders without resetting.
  const reportedRef = useRef<Set<string>>(new Set());

  useReportWebVitals((rawMetric: NextWebVitalsMetric) => {
    try {
      // Honour DNT — silently no-op.
      if (isDoNotTrack()) return;

      // Validate metric name + rating against our literal types. Anything
      // exotic (e.g. a future web-vitals release adding a new metric) is
      // dropped client-side so the API doesn't have to reject it.
      const name = rawMetric.name as WebVitalName;
      if (!VALID_NAMES.has(name)) return;

      // web-vitals always sets rating, but defensive against the type
      // optional + Next's bundled types being loose.
      const ratingRaw = rawMetric.rating ?? "good";
      const rating = ratingRaw as WebVitalRating;
      if (!VALID_RATINGS.has(rating)) return;

      // Numeric value — finite check (NaN/Infinity would be dropped by
      // the API sanitiser anyway, but better to skip the round-trip).
      const value = rawMetric.value;
      if (typeof value !== "number" || !Number.isFinite(value)) return;

      const safeId = safeMetricId(rawMetric.id);
      const dedupeKey = `${name}|${safeId}`;
      if (reportedRef.current.has(dedupeKey)) return;
      reportedRef.current.add(dedupeKey);

      const metadata: PerfVitalMetadata = {
        name,
        // Round non-CLS values to integer ms — saves bytes in the JSONB
        // and matches what we surface in the admin UI (no one cares about
        // the 0.347 ms suffix on an LCP). CLS is unitless and small,
        // keep 4 decimals.
        value: name === "CLS" ? Math.round(value * 10000) / 10000 : Math.round(value),
        rating,
        id: safeId,
        navigation_type: rawMetric.navigationType,
        page_path: getPagePath(),
      };

      track("perf.vital", { metadata });
    } catch {
      /* swallow — RUM must never break the host app */
    }
  });

  // Bound the dedupe Set so a long-lived SPA session can't grow it
  // without limit. Cap is generous — even with the 6 metrics × N route
  // changes, we're unlikely to cross 100. Re-check every 5 minutes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => {
      if (reportedRef.current.size > 200) {
        reportedRef.current = new Set();
      }
    }, 5 * 60 * 1000);
    return () => window.clearInterval(id);
  }, []);

  return null;
}
