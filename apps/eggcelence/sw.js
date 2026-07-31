// Minimal service worker: caches the app shell so it opens instantly (and
// works offline) once visited, and is what makes the app installable on a
// phone. There's no backend here, so this deliberately does NOT try to do
// push notifications — see index.html for how the timer's background
// alert works instead (a native local notification via Capacitor, when
// running in the wrapped app; a best-effort browser Notification when not).

const CACHE_NAME = "eggcelence-v1";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Cache-first, falling back to the network — and opportunistically caching
// whatever the network returns (this is what picks up the CDN-hosted
// React/Babel scripts after the first successful load).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
    })
  );
});
