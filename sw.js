// sw.js
// Cache-first app shell so the app works fully offline once installed.
// Bump CACHE_VERSION whenever any precached file changes, so returning
// users pick up the new version instead of a stale cached one.

const CACHE_VERSION = "loggboken-v13";

const PRECACHE_URLS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/db.js",
  "./js/main.js",
  "./js/domain/dates.js",
  "./js/domain/periodLifecycle.js",
  "./js/domain/goals.js",
  "./js/domain/longTermGoals.js",
  "./js/domain/exportImport.js",
  "./js/domain/sessionLogs.js",
  "./js/render/dom.js",
  "./js/render/goalForms.js",
  "./js/render/sessionLogForm.js",
  "./js/render/goalsPage.js",
  "./js/render/dashboard.js",
  "./js/render/history.js",
  "./js/render/overflowMenu.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only handle GET requests for our own origin; let everything else
  // (Google Fonts, etc.) pass straight through to the network as usual —
  // the browser's own HTTP cache handles those fine.
  if (event.request.method !== "GET" || url.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline: fall back to whatever's cached

      return cached || networkFetch;
    }),
  );
});
