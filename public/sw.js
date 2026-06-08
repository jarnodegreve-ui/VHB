// VHB Portaal service worker — offline-shell + ritblaadje-cache.
// Strategie:
// - HTML/navigatie: network-first (zodat nieuwe deploys direct laden), met
//   cache-fallback bij offline
// - Assets (JS/CSS/fonts/images): cache-first (snel laden)
// - Ritblaadje-metadata (/api/ritblaadje): stale-while-revalidate — toon
//   meteen de gecachte versie, ververs op de achtergrond. Veilig want het
//   ritblaadje is één gedeelde resource (id "current"), geen per-gebruiker
//   data.
// - Ritblaadje-PDF (publieke storage-URL met /ritblaadjes/ in pad): cache-
//   first met achtergrond-revalidate, zodat de PDF offline blijft werken in
//   de iframe + download (opaque response — prima voor weergave/download).
// - Overige /api/*: network-only (geen stale-data risico).
const CACHE_NAME = 'vhb-portaal-v2';
const RITBLAADJE_API = '/api/ritblaadje';
const RITBLAADJE_PDF_MARKER = '/ritblaadjes/';

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

  if (req.method !== 'GET') return;

  // === Ritblaadje-PDF (cross-origin storage) — cache-first + revalidate ===
  // Match op het pad-segment /ritblaadjes/ ongeacht de (Supabase-)origin.
  // Opaque responses zijn prima om in een iframe te tonen of te downloaden.
  if (url.pathname.includes(RITBLAADJE_PDF_MARKER)) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          // Cached eerst tonen (snel + offline), op achtergrond verversen.
          return cached || network;
        }),
      ),
    );
    return;
  }

  // Vanaf hier alleen same-origin.
  if (url.origin !== self.location.origin) return;

  // === Ritblaadje-metadata — stale-while-revalidate ===
  if (url.pathname === RITBLAADJE_API) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(req).then((cached) => {
          const network = fetch(req)
            .then((res) => {
              if (res && res.ok) cache.put(req, res.clone());
              return res;
            })
            .catch(() => cached);
          return cached || network;
        }),
      ),
    );
    return;
  }

  // Overige API: nooit cachen
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
