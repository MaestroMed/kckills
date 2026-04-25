/**
 * Sentry — Edge runtime init (middleware + edge-runtime route handlers).
 *
 * Loaded by `instrumentation.ts#register()` when NEXT_RUNTIME === "edge".
 *
 * The edge runtime runs on V8 isolates (Cloudflare Workers semantics) :
 *  - No Node APIs.
 *  - No long-lived process → can't buffer events for retry.
 *  - Limited bundle size budget.
 * The Sentry SDK strips its Node-specific paths automatically when
 * running on the edge, so this config stays small.
 *
 * Wave 11 / DB ownership : web-side error tracking (P0 launch blocker).
 */

import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;
const ENV = process.env.SENTRY_ENV ?? process.env.NODE_ENV ?? "development";
const RELEASE = process.env.SENTRY_RELEASE;

if (DSN && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    release: RELEASE,

    // Edge runs the OG-image redirect + middleware — both are very low
    // volume per session, so 10% sampling matches Node.
    tracesSampleRate: 0.1,
  });
}
