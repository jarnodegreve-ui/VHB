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
// - Rooster (/api/planning): stale-while-revalidate — chauffeur ziet z'n
//   diensten ook zonder signaal. Gecachet per volledige URL (incl.
//   ?driverId=&month=), dus per gebruiker/maand geïsoleerd.
// - Overige /api/*: network-only (geen stale-data risico).
// v5: cache-hardening — v4-caches kunnen door de SPA-rewrite index.html
// onder asset-URLs bevatten (cache-first = blijvend kapot); bump ruimt op.
// v8: logo-SVG's gewijzigd (tagline 'SINDS 1922' verwijderd) — bump zodat
// cache-first de nieuwe logo's serveert i.p.v. de oude gecachte.
const CACHE_NAME = 'vhb-portaal-v10';
const RITBLAADJE_API = '/api/ritblaadje';
const PLANNING_API = '/api/planning';
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

  // === Ritblaadje-metadata + rooster — stale-while-revalidate ===
  // Keyed op de volledige URL (incl. query), dus /api/planning?driverId=…&
  // month=… cachet per gebruiker/maand apart.
  if (url.pathname === RITBLAADJE_API || url.pathname === PLANNING_API) {
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
          // Alleen een gezonde shell cachen — een 500/503 tijdens een deploy
          // mag de werkende offline-shell niet overschrijven.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match('/'))),
    );
    return;
  }

  // Assets: cache-first. NOOIT html cachen onder een asset-URL: de Vercel
  // SPA-rewrite beantwoordt onbestaande paden met 200 + index.html, en
  // cache-first zou die vergissing voor eeuwig vastzetten (JS-URL die HTML
  // serveert = blijvend kapotte app tot een cache-bump).
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const contentType = res.headers.get('content-type') || '';
        if (
          res.ok &&
          (res.type === 'basic' || res.type === 'opaque') &&
          !contentType.includes('text/html')
        ) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return res;
      });
    }),
  );
});

// --- Push-notificaties ---
self.addEventListener('push', (event) => {
  let payload = { title: 'VHB Portaal', body: '', url: '/' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // geen geldige JSON — toon de generieke titel
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/vhb-icoon-192.png',
      badge: '/vhb-icoon-192.png',
      data: { url: payload.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      // Bestaand tabblad focussen als het portaal al open staat.
      for (const win of wins) {
        if ('focus' in win) {
          win.navigate?.(url);
          return win.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
