/**
 * Next.js 15 instrumentation hook.
 *
 * `register()` is called once per process at server startup (Node) or
 * isolate startup (Edge). It's THE official place to wire up Sentry on
 * the server-side — the historical pattern of importing
 * `sentry.server.config.ts` from a layout no longer fires reliably on
 * App Router builds.
 *
 * `onRequestError` is the SDK's way of capturing nested React Server
 * Component errors that don't bubble up to `error.tsx`.
 *
 * Wave 11 / DB ownership : web-side error tracking (P0 launch blocker).
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/
 */

import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Capture uncaught request errors (RSC + route handlers).
export const onRequestError = Sentry.captureRequestError;
