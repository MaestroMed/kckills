/**
 * Sentry — browser-side init.
 *
 * Loaded by Next.js automatically on the client (no manual import needed).
 * Gracefully no-ops when NEXT_PUBLIC_SENTRY_DSN is unset → zero perf cost
 * during dev / for self-hosted forks that don't want telemetry.
 *
 * Wave 11 / DB ownership : web-side error tracking (P0 launch blocker).
 * Free tier ceiling : 5 000 errors/mo + 100K perf events/mo. Sample rates
 * below are tuned to stay under that for the KC pilot scale.
 */

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;
const ENV = process.env.NEXT_PUBLIC_SENTRY_ENV ?? process.env.NODE_ENV ?? "development";
const RELEASE = process.env.NEXT_PUBLIC_SENTRY_RELEASE;

// 1) No DSN → don't init at all. Saves the ~30KB SDK overhead from being
//    activated on dev builds where there's nowhere to send the events.
// 2) Non-production → also skip. Local dev errors flood the project quota
//    fast and aren't actionable anyway.
if (DSN && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,

    // Perf monitoring — 10% sample keeps us well under the 100K/mo free
    // ceiling at expected V0 traffic (~3000 page loads/day).
    tracesSampleRate: 0.1,

    // Session Replay — Wave 15 (2026-05-07) tuned per audit-2026-05-07
    // (W3) : 1.0 on-error can blow the free-tier 100K perf events/mo
    // budget during an outage spike (10-50 events / replay session).
    // 0.5 keeps statistically meaningful coverage with halved blast.
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 0.5,

    integrations: [
      Sentry.replayIntegration({
        // Privacy : mask all text + block all media inputs by default.
        // We don't want Discord usernames or comment drafts captured.
        maskAllText: true,
        blockAllMedia: true,
      }),
    ],

    // Strip noisy, non-actionable errors before they leave the browser.
    ignoreErrors: [
      // Fired by ad blockers / privacy extensions on Supabase calls.
      "NetworkError when attempting to fetch resource",
      "Failed to fetch",
      "Load failed",
      "TypeError: Failed to fetch",
      // ResizeObserver loop — benign, fired by Chromium when an observed
      // element animates faster than the layout pass.
      "ResizeObserver loop limit exceeded",
      "ResizeObserver loop completed with undelivered notifications.",
      // Cross-origin postMessage from YouTube embeds.
      "ChunkLoadError",
      // Browser extension noise.
      /extension\//i,
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
    ],

    denyUrls: [
      // Browser extensions
      /extensions\//i,
      /^chrome:\/\//i,
      /^chrome-extension:\/\//i,
      /^moz-extension:\/\//i,
    ],

    /**
     * Strip PII from outgoing events. Sentry's default scrubbing covers
     * `Authorization` / `Cookie` request headers, but JWTs occasionally
     * leak into URL fragments (Discord OAuth callback) or breadcrumbs.
     * This is a defense-in-depth pass, not a replacement for Sentry's
     * server-side data scrubbers.
     */
    beforeSend(event) {
      // Drop the request cookie (just in case).
      if (event.request?.cookies) {
        // `cookies` is typed as Record<string, string> — replace each
        // value rather than overwriting with a string.
        for (const key of Object.keys(event.request.cookies)) {
          event.request.cookies[key] = "[Filtered]";
        }
      }
      if (event.request?.headers) {
        const headers = event.request.headers;
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (lower === "cookie" || lower === "authorization" || lower.startsWith("x-supabase-")) {
            headers[key] = "[Filtered]";
          }
        }
      }
      // Strip access_token / id_token / refresh_token URL fragments
      // (the Supabase Auth + Discord OAuth callbacks put them there).
      if (event.request?.url) {
        event.request.url = event.request.url.replace(
          /([?#&])(access_token|id_token|refresh_token|code|state)=[^&]+/gi,
          "$1$2=[Filtered]",
        );
      }
      return event;
    },
  });
}
