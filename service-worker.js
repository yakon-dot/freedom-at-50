/* Freedom at 50 — verified mobile Home release */
const CACHE_NAME = "freedom-at-50-mobile-navigation-v2";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./freedom-mobile-wallpaper.jpg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(APP_SHELL.map(url => cache.add(url).catch(() => null)))
    )
  );
});

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
      ),
      self.clients.claim()
    ])
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;

  const req = event.request;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate" || req.destination === "document") {
    event.respondWith(
      fetch(req, { cache: "no-store" }).then(response => {
        if (response && response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(req, response.clone()));
        }
        return response;
      }).catch(async () =>
        (await caches.match(req)) ||
        (await caches.match("./index.html")) ||
        Response.error()
      )
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const fresh = fetch(req, { cache: "no-cache" }).then(response => {
        if (response && response.ok) {
          caches.open(CACHE_NAME).then(cache => cache.put(req, response.clone()));
        }
        return response;
      }).catch(() => cached);
      return cached || fresh;
    })
  );
});
