/* Freedom at 50 — wallpaper cache + safe offline shell responses + Web Push */
const CACHE_NAME = "freedom-at-50-v1.8.6.163";
const WALLPAPER_CACHE = "freedom-wallpapers-v3";
const APP_SHELL = ["./index.html", "./manifest.webmanifest", "./freedom-push-config.js", "./freedom-purchases-config.js", "./freedom-native-storage.js", "./freedom-native-notifications.js", "./freedom-native-backup.js", "./freedom-native-purchases.js"];
const REMINDER_TITLE = "A little nudge";
const REMINDER_BODY = "Your companion has something for you. Tap to see what’s waiting.";
/* Absolute query URL: iOS openWindow / declarative navigate are unreliable with hash-only targets.
   App opens Home and shows a one-shot companion check-in from this deep link. */
const REMINDER_URL = "https://yakon-dot.github.io/freedom-at-50/?opened=reminder";
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

function freedomParsePushData(pushData) {
  let title = REMINDER_TITLE;
  let body = REMINDER_BODY;
  let url = REMINDER_URL;
  if (!pushData) return { title, body, url };
  try {
    const parsed = typeof pushData.json === "function" ? pushData.json() : null;
    if (parsed && typeof parsed === "object") {
      const note = parsed.notification && typeof parsed.notification === "object" ? parsed.notification : null;
      if (note) {
        if (typeof note.title === "string" && note.title) title = note.title;
        if (typeof note.body === "string" && note.body) body = note.body;
        if (typeof note.navigate === "string" && note.navigate) url = note.navigate;
      }
      if (typeof parsed.title === "string" && parsed.title) title = parsed.title;
      if (typeof parsed.body === "string" && parsed.body) body = parsed.body;
      if (typeof parsed.url === "string" && parsed.url) url = parsed.url;
    }
  } catch (e) {
    try {
      const text = typeof pushData.text === "function" ? pushData.text() : "";
      if (text && typeof text === "string") body = text;
    } catch (e2) {}
  }
  return { title, body, url };
}

self.addEventListener("push", event => {
  /* Always show a visible notification (iOS drops subscriptions after silent pushes). */
  event.waitUntil((async () => {
    const { title, body, url } = freedomParsePushData(event.data);
    try {
      await self.registration.showNotification(title, {
        body,
        icon: "./icon-192.png",
        badge: "./icon-192.png",
        data: { url }
      });
    } catch (err) {
      await self.registration.showNotification(REMINDER_TITLE, {
        body: REMINDER_BODY,
        data: { url: REMINDER_URL }
      });
    }
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const rawTarget =
    (event.notification && event.notification.data && event.notification.data.url) || REMINDER_URL;
  event.waitUntil((async () => {
    /* Resolve against SW scope so subdirectory GitHub Pages stays in-app. */
    const absolute = new URL(rawTarget, self.registration.scope).href;
    const scope = self.registration.scope;
    const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const client of all) {
      try {
        if (!client.url || !String(client.url).startsWith(scope)) continue;
        /* Match working Push Lab order: navigate, then focus (hash-only targets failed on iOS). */
        if (typeof client.navigate === "function") {
          try {
            await client.navigate(absolute);
          } catch (e) {}
        }
        if ("focus" in client) await client.focus();
        try {
          client.postMessage({ type: "FREEDOM_OPEN_REMINDER_HOME", url: absolute });
        } catch (e) {}
        return;
      } catch (e) {}
    }
    if (clients.openWindow) {
      await clients.openWindow(absolute);
    }
  })());
});
