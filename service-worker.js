/* Freedom at 50 — v1.8.6.3 cache reset */
const CACHE_NAME = "freedom-at-50-v1.8.6.3";

self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  // Always fetch pages from the live site first.
  // Old cached HTML must never override a successful network response.
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  // Other assets also prefer the live version.
  event.respondWith(
    fetch(request, { cache: "no-store" })
      .catch(() => caches.match(request))
  );
});
