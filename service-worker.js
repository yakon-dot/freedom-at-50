/* Freedom at 50 — wallpaper cache restored (render never gated on preload) */
const CACHE_NAME = "freedom-at-50-v1.8.6.18";
const WALLPAPER_CACHE = "freedom-wallpapers-v1";
const WALLPAPERS = [
  "./overview-wallpaper.png",
  "./journey-wallpaper.png",
  "./goals-wallpaper.png",
  "./pension-wallpaper.png",
  "./archive-wallpaper.png",
  "./welcome-wallpaper.jpg"
];

function isWallpaperRequest(url) {
  return WALLPAPERS.some(path => url.pathname.endsWith(path.replace("./", "")));
}

self.addEventListener("install", event => {
  // Warm the wallpaper cache in the background. Failures must never block install.
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

  // Wallpapers: cache-first. Do not use cache:"no-store" — that forced multi‑MB
  // re-downloads on every launch. Page CSS/classes must never wait on this path.
  if (isWallpaperRequest(url)) {
    event.respondWith(
      caches.open(WALLPAPER_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response && response.ok) cache.put(request, response.clone());
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
