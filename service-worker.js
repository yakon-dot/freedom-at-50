/* Freedom at 50 — service worker v1.8.3 */
const CACHE_NAME="freedom-at-50-v1.8.3";
self.addEventListener("install",event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(["./","./index.html","./manifest.webmanifest","./icon-192.png","./icon-512.png"]).catch(()=>null)));
});
self.addEventListener("activate",event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const req=event.request;
  if(req.mode==="navigate"||req.destination==="document"){
    event.respondWith(fetch(req,{cache:"no-store"}).catch(()=>caches.match("./index.html")));
    return;
  }
  event.respondWith(fetch(req,{cache:"no-cache"}).catch(()=>caches.match(req)));
});
