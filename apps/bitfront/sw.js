// =====================================================================
// BITFRONT — sw.js
//
// Cache-first service worker for the app shell. There's no backend and no
// remote data, so once these files are cached the game runs with the
// network off, on a plane, forever.
//
// Bump CACHE when any shell file changes — the old cache is deleted on
// activate, which is the whole update mechanism.
// =====================================================================

const CACHE = "bitfront-v1";

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./sprites.js",
  "./data.js",
  "./game.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network-first, cache as a fallback.
//
// The obvious choice here is cache-first — it's faster and it's what most
// app-shell workers do. It's also a trap during development: once the shell
// is cached, edits to game.js are invisible until the cache name changes, so
// you sit there playing a stale build wondering why your fix did nothing.
// Network-first costs one request per file when online and still runs fully
// offline, which is the right trade for a game that's edited by hand.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        // Keep the cache warm with whatever the network just gave us.
        if (res && res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match("./index.html")))
  );
});
