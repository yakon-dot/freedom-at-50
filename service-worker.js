/* Freedom at 50 — v1.8.6.2 */
const CACHE_NAME="freedom-at-50-v1.8.6.2";
const APP_SHELL=["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png","./overview-wallpaper.png","./journey-wallpaper.png"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE_NAME).then(c=>Promise.all(APP_SHELL.map(u=>c.add(u).catch(()=>null)))))});
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("message",e=>{if(e.data&&e.data.type==="SKIP_WAITING")self.skipWaiting()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;const r=e.request;if(r.mode==="navigate"||r.destination==="document"){e.respondWith(fetch(r,{cache:"no-store"}).catch(()=>caches.match("./index.html")));return}e.respondWith(fetch(r,{cache:"no-cache"}).catch(()=>caches.match(r)))});
