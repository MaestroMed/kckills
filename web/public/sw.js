// LoLTok Service Worker — PWA + Push Notifications
//
// Bumped to v4 (2026-04-23) when the push handler started consuming the
// `image`, `tag`, `kind` and `actions` fields shipped by the worker
// push_notifier module (PR16). A version bump is mandatory because old
// installations cling to the previous CACHE_NAME until activate fires;
// without it, returning users hit the stale handler from cache for days.

const CACHE_NAME = "loltok-v4";
const PRECACHE = ["/scroll", "/", "/manifest.json", "/offline.html"];

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

  const title = data.title || "KCKILLS";
  const options = {
    body: data.body || "Nouveau kill KC !",
    icon: data.icon || "/icons/icon-192x192.png",
    badge: "/icons/icon-192x192.png",
    image: data.image || undefined,
    tag: data.tag || data.kind || "kckills-default",
    renotify: true,
    requireInteraction: data.kind === "kill_of_the_week",
    data: {
      url: data.url || "/scroll",
      kind: data.kind || "kill",
    },
    actions: [
      { action: "view", title: "Voir le clip" },
      { action: "rate", title: "Noter" },
    ],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/scroll";
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
