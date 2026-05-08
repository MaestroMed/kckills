# Native shells — V44 (iOS Capacitor) + V45 (Android TWA)

Wave 26.3 (2026-05-08) — config scaffolds for wrapping the kckills.com
PWA into native iOS + Android shells. **None of this is "ship-ready"
on its own** — each path needs an Apple / Google developer account
+ signing keys + a build pipeline. Treat the files in this folder
as the canonical bootstrap config.

## Why two paths

* **V44 — Capacitor (iOS)** : iOS Safari doesn't expose haptic
  feedback, native push, or fullscreen file system to PWAs. Capacitor
  wraps the web view + provides JS bridges to the native APIs we
  actually need (push, haptics, share-sheet).
* **V45 — TWA (Trusted Web Activity, Android)** : Chrome on Android
  already gives us 90 % of native feel via PWA. The TWA route makes
  it installable from the Play Store, removes the URL bar, and
  unlocks a few native APIs without a full Capacitor wrap.

## V44 — iOS Capacitor

**Status** : SCAFFOLD only. Real ship needs :

1. `npm install -g @capacitor/cli @capacitor/core @capacitor/ios`.
2. `cd native && npx cap init "KCKILLS" "com.kckills.app" --web-dir=../web/.next/static`.
3. `npx cap add ios`.
4. Open `native/ios/App.xcworkspace` in Xcode, set the team +
   signing.
5. Plug in `@capacitor/push-notifications` for V35 native push
   delivery (replaces the web push fallback when the app is
   installed).
6. `npx cap copy && npx cap sync ios`.
7. Build in Xcode → Archive → upload to App Store Connect.

`capacitor.config.ts` (committed below) carries the manifest
metadata + the deep-link config so external links (Discord,
shared kill URLs) open in the app instead of mobile Safari.

## V45 — Android TWA

**Status** : SCAFFOLD only. Real ship needs :

1. Bubblewrap CLI : `npm install -g @bubblewrap/cli`.
2. `cd native && bubblewrap init --manifest=https://kckills.com/manifest.json`.
3. Bubblewrap will ask for the package name (`com.kckills.app`),
   the app name, the launch URL, the SHA-256 fingerprint of the
   signing key.
4. `bubblewrap build` → APK.
5. Upload to Play Console.

The asset link file `well-known/assetlinks.json` (committed below)
must be served from `https://kckills.com/.well-known/assetlinks.json`
so Android trusts the TWA. The web app already has `/.well-known/`
routes ; one more handler in `web/src/app/.well-known/`.

## Push routing

Once V44 is shipped, the worker's `push_notifier` module needs to
distinguish web push subscriptions from APNs tokens. Migration 057
already added `push_subscriptions.player_filter` ; a follow-up
migration will add `push_subscriptions.platform` (web | ios | android).

The `services/push_apns.py` module is the future home of the
APNs HTTP/2 client. Not committed yet ; ships alongside the
first iOS test build.
