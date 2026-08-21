/* Freedom at 50 — cache reset release v1.8.5.3 */
const CACHE_NAME = "freedom-at-50-v1.8.5.3";

self.addEventListener("install", event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll([
        "./",
        "./index.html",
        "./manifest.webmanifest",
        "./icon-192.png",
        "./icon-512.png"
      ]).catch(() => null))
  );
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const request = event.request;

  // Always prefer the live GitHub Pages version.
  event.respondWith(
    fetch(request, { cache: "no-store" })
      .then(response => response)
      .catch(async () => {
        if (request.mode === "navigate" || request.destination === "document") {
          return (await caches.match("./index.html")) || Response.error();
        }
        return (await caches.match(request)) || Response.error();
      })
  );
});
