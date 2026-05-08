/**
 * Capacitor config — V44 (Wave 26.3).
 *
 * iOS shell wrapper for the kckills.com PWA. Server URL points at
 * production ; the native app is essentially a chrome-less
 * WKWebView that loads the live web app.
 *
 * To go full offline-capable later (V44b), set `bundledWebRuntime:
 * true` and ship the static export of /web in the IPA. Out of scope
 * for V44 v1.
 *
 * Build steps in `native/README.md`.
 */
import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.kckills.app",
  appName: "KCKILLS",
  webDir: "../web/out",
  bundledWebRuntime: false,
  server: {
    // Live production. The shell ALWAYS loads the deployed web app
    // — we don't ship a stale bundle inside the IPA.
    url: "https://kckills.com",
    cleartext: false,
  },
  ios: {
    // iPhone 12+ (the typical KC fan demographic — French esports
    // viewers tend to upgrade) → 13.0 minimum is generous.
    minVersion: "15.0",
    // Inset the web view under the dynamic island / notch.
    // The PWA already handles `env(safe-area-inset-*)` so we just
    // need to let it through.
    contentInset: "always",
    // Background colour seen during the launch transition + when
    // the web view is empty. Matches `--bg-primary`.
    backgroundColor: "#010A13",
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: "#010A13",
      androidSpinnerStyle: "small",
      spinnerColor: "#C8AA6E",
    },
    PushNotifications: {
      // APNs presentation : surface the alert + sound + badge by
      // default. The user can tweak per-kind in /settings (V36b).
      presentationOptions: ["badge", "sound", "alert"],
    },
    Haptics: {
      // V5 + V3 — long-press + snap-commit haptics already wired
      // in the web layer via `navigator.vibrate`. The Capacitor
      // bridge upgrades that to native taptic engine on iOS.
    },
    Share: {
      // V8 — native share sheet preferred over the custom one when
      // the OS provides it. The web layer already feature-detects.
    },
  },
};

export default config;
