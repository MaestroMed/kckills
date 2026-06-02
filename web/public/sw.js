// LoLTok Service Worker — PWA + Push Notifications
//
// Bumped to v6 (2026-05-13) for the LIVE flow : new `kind` values
// `live_kill` and `live_match`, dedicated action buttons that deep-link
// to /live, and a `vibrate` pattern that fires only on live notifs so
// fans get a tactile cue mid-match. Older installs still running v5
// will keep generic notifications working but will miss the new
// live-specific actions until the new SW activates.
//
// Bumped to v5 (2026-04-24) for the action-button routing + the
// `pushsubscriptionchange` re-subscription path. Older installs still
// running v4 will keep their notifications but will miss the
// action=rate deep-link until the new SW activates.
//
// Bumped to v4 (2026-04-23) when the push handler started consuming the
// `image`, `tag`, `kind` and `actions` fields shipped by the worker
// push_notifier module (PR16). A version bump is mandatory because old
// installations cling to the previous CACHE_NAME until activate fires;
// without it, returning users hit the stale handler from cache for days.

// ── Cache versioning (Wave 36 #33 — stale-JS-after-deploy fix) ──────────
//
// THE BUG : the previous fetch handler network-firsted *every* same-origin
// GET into ONE fixed cache (`loltok-v6`) and only purged caches whose name
// differed from the current one. Because the cache name was tied to manual
// SW edits — not to each deploy — a normal redeploy left the prior build's
// hashed `_next/static/...chunk.js` and cached HTML sitting in `loltok-v6`.
// On any offline/flaky fetch the SW then served stale HTML pointing at
// chunk hashes that no longer exist on the CDN → blank screen / ChunkLoad
// errors for returning users. Network-first masked it on a good network but
// never *evicted* the stale build.
//
// THE FIX :
//   1. Build-scoped cache name. The SW reads a `?v=<build>` query param off
//      its OWN script URL — `layout.tsx` registers `/sw.js?v=<commit-sha>`
//      and changes that value on every deploy (sw.js itself is byte-stable
//      and can't be rewritten because it's served verbatim from /public).
//      A changed `?v=` makes the browser re-fetch + re-install the SW, and
//      the new value flows into CACHE_NAME ⇒ the activate sweep drops the
//      entire prior build's cache in one shot. Falls back to "dev" when the
//      param is absent (local `next dev`).
//   2. Per-request-class strategy instead of "cache everything":
//        • Next dev HMR / hot-update  → network only, NEVER cached.
//        • Navigations (documents)    → network-first → cached shell →
//                                        offline.html. HTML is NOT written
//                                        to the runtime cache (stale HTML is
//                                        the root cause of #33); we only
//                                        ever fall back to the precached
//                                        shell routes.
//        • `/_next/static/*` (hashed) → stale-while-revalidate. Content is
//                                        addressed by hash, so a cached copy
//                                        is always correct; we still refetch
//                                        in the background to warm the new
//                                        build's chunks.
//        • icons / manifest / static  → cache-first (rarely change; cheap).
//        • everything else same-origin → network-first, no persistence.
// Derive the build id from this script's own URL (?v=<commit-sha>), set by
// the registration in layout.tsx. Defaults to "dev" for local `next dev`
// where the registration omits the param. Wrapped in try/catch because
// `self.location` / URL parsing must never throw and dead-letter the SW.
function readBuildId() {
  try {
    const v = new URL(self.location.href).searchParams.get("v");
    return v && v.trim() ? v.trim().slice(0, 64) : "dev";
  } catch {
    return "dev";
  }
}
const BUILD_ID = readBuildId();
const CACHE_PREFIX = "loltok";
// Bump the `v6` token when the SW logic itself changes; BUILD_ID busts on
// every deploy. Either changing produces a fresh cache + activate sweep.
const CACHE_NAME = `${CACHE_PREFIX}-v6-${BUILD_ID}`;
const PRECACHE = ["/scroll", "/live", "/", "/manifest.json", "/offline.html"];

// Static, slow-moving assets that are safe to cache-first (not content
// hashed, but they change at most once per deploy and the activate sweep
// re-primes them under the new cache name anyway).
function isStaticAsset(url) {
  return (
    url.pathname === "/manifest.json" ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/fonts/") ||
    /\.(?:png|jpg|jpeg|gif|svg|webp|avif|ico|woff2?|ttf)$/i.test(url.pathname)
  );
}

// Next.js content-hashed build output. These are immutable per build — a
// cached hit is always byte-correct, so stale-while-revalidate is safe and
// fast.
function isHashedNextAsset(url) {
  return url.pathname.startsWith("/_next/static/");
}

// Next.js dev hot-reload traffic. Caching this breaks HMR and pins dev to a
// stale module graph — bypass the SW entirely.
function isDevHmr(url) {
  return (
    url.pathname.startsWith("/_next/webpack-hmr") ||
    url.pathname.startsWith("/__nextjs") ||
    url.pathname.includes("/_next/static/webpack/") ||
    /\.hot-update\.(?:json|js)$/i.test(url.pathname)
  );
}

// Install: precache shell, then take over immediately.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate: drop every cache from a prior build/version (anything under our
// prefix that isn't the live name), then claim open clients.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

// Fetch: per-request-class strategy for same-origin only.
// Cross-origin requests (CDN clips/images, fonts, APIs) are NOT intercepted
// to avoid CSP connect-src conflicts and opaque-response cache.put errors.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Only handle same-origin — let cross-origin pass through untouched.
  if (url.origin !== self.location.origin) return;

  // Skip chrome-extension and other non-http schemes.
  if (!url.protocol.startsWith("http")) return;

  // Never touch dev HMR — it must hit the network raw every time.
  if (isDevHmr(url)) return;

  // Navigations / documents → network-first, fall back to the precached
  // shell (NOT runtime-cached HTML), then offline.html. We deliberately do
  // not persist navigation responses: stale HTML referencing dead chunk
  // hashes is exactly the regression #33 is about.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return (
          (await cache.match(event.request)) ||
          (await cache.match(url.pathname)) ||
          (await cache.match("/offline.html")) ||
          new Response("Offline", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          })
        );
      })
    );
    return;
  }

  // Hashed Next build assets → stale-while-revalidate.
  if (isHashedNextAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then((response) => {
            if (response && response.status === 200 && response.type === "basic") {
              cache.put(event.request, response.clone()).catch(() => {});
            }
            return response;
          })
          .catch(() => null);
        return cached || (await network) || new Response("", { status: 504 });
      })()
    );
    return;
  }

  // Static icons / manifest / fonts → cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(event.request);
        if (cached) return cached;
        try {
          const response = await fetch(event.request);
          if (response && response.status === 200 && response.type === "basic") {
            cache.put(event.request, response.clone()).catch(() => {});
          }
          return response;
        } catch {
          return new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Everything else same-origin (data / API / dynamic) → network-first with
  // no persistence, falling back to any prior cached copy if offline.
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cached = await caches.match(event.request);
      return cached || new Response("Offline", { status: 503 });
    })
  );
});

// Push notifications
//
// Payload shape (built by lib/push/send.ts and modules/push_notifier.py) :
//   {
//     title: "Caliste → Faker",
//     body:  "Outplay 1v2 dans la jungle adverse",
//     url:   "/scroll?kill=<uuid>",
//     icon:  "/icons/icon-192x192.png",         (optional override)
//     image: "https://clips.kckills.com/...",   (optional rich preview)
//     tag:   "kill:<uuid>" | "kotw:2026-w17",   (collapses repeats)
//     kind:  "kill" | "kill_of_the_week" | "editorial_pin" | ...
//   }
//
// `tag` is the de-dupe key the OS uses to collapse stacked notifications
// — passing the same tag replaces the previous toast instead of stacking
// a second one. This matters for KOTW (one weekly slot) and live_match
// (one per game).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }

  const kind = data.kind || "kill";
  const title = data.title || "KCKILLS";

  // Only attach the [Voir le clip / Noter] action buttons for kill-class
  // notifications — broadcast / system / live_match either point at a
  // page that has nothing to rate or are too short-lived to be worth
  // rating. Showing useless buttons trains users to ignore them.
  const isKillNotif = kind === "kill" || kind === "kill_of_the_week";

  // v6 (live flow) — `live_kill` is fired by the worker when a clip
  // gets published mid-match. It deep-links to /kill/<id> AND offers a
  // shortcut to the dedicated /live feed so the fan can pivot from
  // single-clip view to the running match in one tap.
  const isLiveKill = kind === "live_kill";
  // `live_match` is fired when a KC match goes live. Short-lived
  // notification — no rating possible (no kill yet) ; deep-links to
  // /live so the fan lands on the cinematic header.
  const isLiveStart = kind === "live_match";

  let actions = [];
  if (isLiveKill) {
    actions = [
      { action: "view", title: "Voir le clip" },
      { action: "live", title: "Le live" },
    ];
  } else if (isLiveStart) {
    actions = [
      { action: "live", title: "Ouvrir le live" },
      { action: "dismiss", title: "Plus tard" },
    ];
  } else if (isKillNotif) {
    actions = [
      { action: "view", title: "Voir le clip" },
      { action: "rate", title: "Noter" },
    ];
  }

  const options = {
    body: data.body || "Nouveau kill KC !",
    icon: data.icon || "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    image: data.image || undefined,
    tag: data.tag || kind || "kckills-default",
    renotify: true,
    requireInteraction: kind === "kill_of_the_week",
    // Vibrate on live-flow notifs only so the rest of the system isn't
    // intrusive. Pattern : short triple-pulse, totals ~600 ms.
    vibrate: isLiveKill || isLiveStart ? [120, 60, 120, 60, 240] : undefined,
    data: {
      url: data.url || (isLiveStart || isLiveKill ? "/live" : "/scroll"),
      // Carry the canonical /live URL so the "live" action button can
      // navigate even when `url` already points at the kill detail.
      liveUrl: data.liveUrl || "/live",
      kind,
    },
    actions,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click
//
// Action handling :
//   * default click (no action button)  → navigate to data.url
//   * action === "view"                 → same as default
//   * action === "rate"                 → navigate to data.url + ?action=rate
//                                         so the kill page can pop the
//                                         rating modal on mount
//
// Window focus : we look for an existing tab whose URL starts with the
// kckills origin (NOT just `includes(url)` — that fails when the user
// is already on a different kill page, sending them to the wrong one).
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const baseUrl = event.notification.data?.url || "/scroll";
  const liveUrl = event.notification.data?.liveUrl || "/live";
  const action = event.action || "view";
  // v6 — the `live` action button (live_kill / live_match notifs)
  // always opens /live regardless of what data.url points at. The
  // `dismiss` action just closes the notif without navigating.
  let targetUrl;
  if (action === "dismiss") {
    return; // already closed above, nothing else to do
  } else if (action === "live") {
    targetUrl = liveUrl;
  } else if (action === "rate") {
    targetUrl = baseUrl + (baseUrl.includes("?") ? "&" : "?") + "action=rate";
  } else {
    targetUrl = baseUrl;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const origin = self.location.origin;
      // Prefer focusing an existing same-origin tab and navigating it,
      // rather than opening a fresh window each time. Falls back to
      // openWindow when no kckills tab is currently open.
      for (const client of clients) {
        if (client.url.startsWith(origin) && "focus" in client) {
          // navigate() is supported in modern Chromium / Firefox SW
          // contexts; fall back to focus-only when not available.
          if ("navigate" in client && typeof client.navigate === "function") {
            return client.navigate(targetUrl).then(() => client.focus());
          }
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});

// Re-subscription handler
//
// Fires when the browser rotates the push subscription (the endpoint
// URL changes — usually because the FCM/APNs token expired or the
// browser auto-renewed). If we don't re-POST the new subscription, the
// server is stuck with a stale endpoint that returns 410 forever and
// the user silently stops receiving notifications.
//
// This is best-effort : if the subscribe() call fails (no permission,
// VAPID key changed, network down) we just give up — the user can
// re-enable from /settings on their next visit.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const oldSub = event.oldSubscription;
        // Re-subscribe with the same applicationServerKey if available,
        // otherwise the browser uses the previous one transparently.
        const newSub = event.newSubscription
          ?? (oldSub && oldSub.options
            ? await self.registration.pushManager.subscribe(oldSub.options)
            : null);
        if (!newSub) return;
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(newSub.toJSON()),
          credentials: "same-origin",
        });
      } catch {
        // Swallow — the user can recover from /settings.
      }
    })()
  );
});
