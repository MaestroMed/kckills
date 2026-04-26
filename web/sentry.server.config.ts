/**
 * Sentry — Node.js runtime init (server components, route handlers,
 * middleware running on the Node runtime).
 *
 * Loaded by `instrumentation.ts#register()`. Not bundled into client JS.
 *
 * Wave 11 / DB ownership : web-side error tracking (P0 launch blocker).
 */

import * as Sentry from "@sentry/nextjs";

// Server can read the public DSN too (it's NEXT_PUBLIC_*) — and in
// production deployments we expect the same value to be present.
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
const ENV = process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? "development";
const RELEASE = process.env.SENTRY_RELEASE;

if (DSN && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,

    // Node runtime sees a lot more requests than the client → keep the
    // sample rate at 10% to avoid blowing through the 100K perf event
    // ceiling on the Vercel free tier.
    tracesSampleRate: 0.1,

    // Don't capture local breadcrumbs that contain Supabase service-role
    // keys (the worker already filters its own — this is the web side).
    beforeSend(event) {
      if (event.request?.headers) {
        const headers = event.request.headers;
        for (const key of Object.keys(headers)) {
          const lower = key.toLowerCase();
          if (
            lower === "cookie" ||
            lower === "authorization" ||
            lower === "x-supabase-auth" ||
            lower === "apikey"
          ) {
            headers[key] = "[Filtered]";
          }
        }
      }
      // Strip secrets that occasionally leak into error messages
      // (e.g. Supabase fetch errors that include the JWT in their URL).
      if (event.exception?.values) {
        for (const ex of event.exception.values) {
          if (ex.value) {
            ex.value = ex.value
              .replace(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[JWT_FILTERED]")
              .replace(/sk-[A-Za-z0-9]{20,}/g, "[API_KEY_FILTERED]");
          }
        }
      }
      return event;
    },
  });
}
