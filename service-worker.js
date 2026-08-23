/* Freedom at 50 — v1.8.6.4 wallpaper cache */
const APP_CACHE = "freedom-at-50-v1.8.6.4";
const WALLPAPER_CACHE = "freedom-wallpapers-v1";
const WALLPAPERS = [
  "./overview-wallpaper.png",
  "./journey-wallpaper.png",
  "./goals-wallpaper.png",
  "./pension-wallpaper.png"
];

function isWallpaperRequest(url) {
  return WALLPAPERS.some(path => url.pathname.endsWith(path.replace("./", "")));
}

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(WALLPAPER_CACHE).then(cache => cache.addAll(WALLPAPERS).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => key !== WALLPAPER_CACHE)
        .map(key => caches.delete(key))
    );
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

  if (isWallpaperRequest(url)) {
    event.respondWith(
      caches.open(WALLPAPER_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response.ok) cache.put(request, response.clone());
          return response;
        } catch (err) {
          const fallback = await cache.match(request);
          if (fallback) return fallback;
          throw err;
        }
      })
    );
    return;
  }

  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .catch(() => caches.match("./index.html"))
    );
    return;
  }

  event.respondWith(
    fetch(request, { cache: "no-store" })
      .catch(() => caches.match(request))
  );
});
