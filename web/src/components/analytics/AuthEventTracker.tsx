"use client";

/**
 * AuthEventTracker — one-shot reader for the `kc_auth_event` cookie set
 * by /auth/callback after a successful Discord sign-in.
 *
 * The auth callback is a server route that issues a redirect — there's
 * no client-side moment in which to call track(). Instead we drop a
 * short-lived cookie that the next page load picks up here. The cookie
 * is consumed + cleared on read so we never double-fire.
 *
 * Mount this component once at the root of the app (in providers / layout)
 * so it runs on every navigation following a sign-in.
 */

import { useEffect } from "react";
import { track } from "@/lib/analytics/track";

const COOKIE_NAME = "kc_auth_event";

export function AuthEventTracker() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    try {
      const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE_NAME}=([^;]+)`));
      if (!m) return;
      const value = m[1];
      // Clear the cookie immediately — even if the track call fails we
      // don't want to refire on subsequent navigations.
      document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
      if (value === "auth.signup" || value === "auth.login") {
        track(value);
      }
    } catch {
      /* document.cookie blocked / sandboxed — silent */
    }
  }, []);
  return null;
}
