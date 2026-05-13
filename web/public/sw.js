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

const CACHE_NAME = "loltok-v6";
const PRECACHE = ["/scroll", "/live", "/", "/manifest.json", "/offline.html"];

// Install: precache shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for same-origin only.
// Cross-origin requests (CDN images, fonts, APIs) are NOT intercepted
// to avoid CSP connect-src conflicts and cache-put errors.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);

  // Only cache same-origin requests — let cross-origin go through normally
  if (url.origin !== self.location.origin) return;

  // Skip chrome-extension and other non-http schemes
  if (!url.protocol.startsWith("http")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Only cache successful, basic (same-origin) responses.
        // Cross-origin opaque responses can't be cached safely and
        // throw NetworkError on cache.put().
        if (
          response.status === 200 &&
          response.type === "basic" &&
          (event.request.method === "GET" || event.request.method === "HEAD")
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone).catch(() => { /* ignore */ });
          }).catch(() => { /* ignore */ });
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          if (event.request.mode === "navigate") {
            return caches.match("/offline.html");
          }
          return new Response("Offline", { status: 503 });
        })
      )
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
