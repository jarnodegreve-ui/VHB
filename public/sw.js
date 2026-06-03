// VHB Portaal service worker — minimaal offline-shell cache.
// Strategie:
// - HTML/navigatie: network-first (zodat nieuwe deploys direct laden), met
//   cache-fallback bij offline
// - Assets (JS/CSS/fonts/images): cache-first (snel laden)
// - API-calls (/api/*): network-only (geen stale data risico)
const CACHE_NAME = 'vhb-portaal-v1';

self.addEventListener('install', (event) => {
  // Skip waiting zodat een nieuwe SW direct actief wordt
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Niet onderscheppen voor non-GET of cross-origin
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API: nooit cachen
  if (url.pathname.startsWith('/api/')) return;

  // HTML navigatie: network-first, val terug op cache offline
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/'))),
    );
    return;
  }

  // Assets: cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (res.type === 'basic' || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});
