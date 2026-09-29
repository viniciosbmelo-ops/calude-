const CACHE_NAME = "docregen-v1";
// Paths are resolved against the service worker location so the app works
// both at the domain root and under a base path (e.g. /docregen/).
const SCOPE = new URL("./", self.location).pathname;
const STATIC_ASSETS = [
  SCOPE,
  `${SCOPE}manifest.json`,
  `${SCOPE}icons/icon-192.png`,
  `${SCOPE}icons/icon-512.png`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle GET; never interfere with POST/PUT/etc.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Same-origin only.
  if (url.origin !== self.location.origin) return;

  // Never cache API calls — always go to network.
  if (url.pathname.startsWith("/api/")) {
    return;
  }

  // Navigations (HTML): network-first so the app shell is never stale after a
  // deploy, falling back to cache when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(SCOPE, clone));
          return response;
        })
        .catch(() => caches.match(request).then((c) => c || caches.match(SCOPE))),
    );
    return;
  }

  // Static assets (hashed by Vite): cache-first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        }),
    ),
  );
});
