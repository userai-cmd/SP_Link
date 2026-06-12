/* SAT-Postex Connect — Service Worker */

const CACHE_NAME = "sp-link-static-v1";

const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/css/app.css",
  "/js/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API or WebSocket traffic.
  if (url.pathname.startsWith("/api") || url.pathname.startsWith("/ws")) return;
  if (event.request.method !== "GET") return;

  // Uploads: cache-first (immutable filenames).
  if (url.pathname.startsWith("/uploads/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      }),
    );
    return;
  }

  // Static assets and navigation: network-first with cache fallback,
  // so the app still launches offline.
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && url.origin === location.origin) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
        return Response.error();
      }),
  );
});

/* Background sync structure: the app can queue outgoing messages in
   IndexedDB and register a sync; this handler is the hook for flushing
   the queue when connectivity returns. */
self.addEventListener("sync", (event) => {
  if (event.tag === "sp-link-outbox") {
    event.waitUntil(
      self.clients.matchAll().then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "sync:outbox" });
        }
      }),
    );
  }
});
