/* Freedom at 50 — wallpaper cache + safe offline shell responses */
const CACHE_NAME = "freedom-at-50-v1.8.6.154";
const WALLPAPER_CACHE = "freedom-wallpapers-v3";
const APP_SHELL = ["./index.html", "./manifest.webmanifest"];
const WALLPAPERS = [
  "./companion-select-wallpaper.jpg",
  "./overview-wallpaper.png",
  "./journey-wallpaper.png?v=3",
  "./goals-wallpaper.png",
  "./pension-wallpaper.png?v=3",
  "./archive-wallpaper.png",
  "./notes-wallpaper.jpg",
  "./welcome-wallpaper.jpg?v=2"
];

function isWallpaperRequest(url) {
  return WALLPAPERS.some(path => {
    const bare = path.replace("./", "").split("?")[0];
    return url.pathname.endsWith(bare);
  });
}

function offlineDocumentResponse() {
  const body = "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Freedom offline</title></head><body style=\"margin:0;font-family:system-ui,sans-serif;background:#0b0c0e;color:#f5f4f0;padding:28px;line-height:1.45\"><h1 style=\"font-size:1.35rem;margin:0 0 12px\">Freedom is offline</h1><p style=\"margin:0;opacity:.8\">Reconnect to load the app. Your personal data saved on this device is unchanged.</p></body></html>";
  return new Response(body, {
    status: 503,
    statusText: "Service Unavailable",
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function offlineAssetResponse() {
  return new Response("", {
    status: 503,
    statusText: "Service Unavailable",
    headers: { "Cache-Control": "no-store" }
  });
}

self.addEventListener("install", event => {
  // Warm shell + wallpaper caches. Failures must never block install.
  event.waitUntil((async () => {
    try {
      const shell = await caches.open(CACHE_NAME);
      await shell.addAll(APP_SHELL).catch(() => {});
    } catch (e) {}
    try {
      const wallpapers = await caches.open(WALLPAPER_CACHE);
      await wallpapers.addAll(WALLPAPERS).catch(() => {});
    } catch (e) {}
  })());
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keep = new Set([CACHE_NAME, WALLPAPER_CACHE]);
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => !keep.has(key))
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

  // Wallpapers: cache-first. Never reject respondWith with an uncaught throw.
  if (isWallpaperRequest(url)) {
    event.respondWith(
      caches.open(WALLPAPER_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;
        try {
          const response = await fetch(request);
          if (response && response.ok) cache.put(request, response.clone());
          if (response) return response;
          return offlineAssetResponse();
        } catch (err) {
          const fallback = await cache.match(request);
          return fallback || offlineAssetResponse();
        }
      })
    );
    return;
  }

  // Documents: live network first; offline uses cached shell or a valid offline page.
  if (request.mode === "navigate" || request.destination === "document") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then(async response => {
          if (response && response.ok) {
            try {
              const cache = await caches.open(CACHE_NAME);
              await cache.put("./index.html", response.clone());
            } catch (e) {}
          }
          return response || offlineDocumentResponse();
        })
        .catch(async () => {
          const cached =
            (await caches.match("./index.html")) ||
            (await caches.match(request));
          return cached || offlineDocumentResponse();
        })
    );
    return;
  }

  // Other assets: live first; offline cache hit or a valid empty 503 (never undefined).
  event.respondWith(
    fetch(request, { cache: "no-store" })
      .then(response => response || offlineAssetResponse())
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || offlineAssetResponse();
      })
  );
});
