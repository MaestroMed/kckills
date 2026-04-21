// LoLTok Service Worker — PWA + Push Notifications

const CACHE_NAME = "loltok-v2";
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
self.addEventListener("push", (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || "LoLTok";
  const options = {
    body: data.body || "Nouveau kill KC !",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/scroll" },
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
