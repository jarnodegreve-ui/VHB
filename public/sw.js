// VHB Portaal service worker — offline-shell + ritblaadje-cache.
// Strategie:
// - HTML/navigatie: network-first (zodat nieuwe deploys direct laden), met
//   cache-fallback bij offline
// - Assets (JS/CSS/fonts/images): cache-first (snel laden)
// - Ritblaadje-metadata (/api/ritblaadje): stale-while-revalidate — toon
//   meteen de gecachte versie, ververs op de achtergrond. Veilig want het
//   ritblaadje is één gedeelde resource (id "current"), geen per-gebruiker
//   data.
// - Ritblaadje-PDF (ondertekende storage-URL met /ritblaadjes/ in pad):
//   cache-first met achtergrond-revalidate, zodat de PDF offline blijft
//   werken in de iframe + download. Cache-key = URL zónder query: signed
//   URLs wisselen per fetch van token en zouden anders blob na blob opstapelen.
// - Rooster (/api/planning): stale-while-revalidate — chauffeur ziet z'n
//   diensten ook zonder signaal. Gecachet per volledige URL (incl.
//   ?driverId=&month=), dus per gebruiker/maand geïsoleerd.
// - Overige /api/*: network-only (geen stale-data risico).
// v5: cache-hardening — v4-caches kunnen door de SPA-rewrite index.html
// onder asset-URLs bevatten (cache-first = blijvend kapot); bump ruimt op.
// v8: logo-SVG's gewijzigd (tagline 'SINDS 1922' verwijderd) — bump zodat
// cache-first de nieuwe logo's serveert i.p.v. de oude gecachte.
// v11: ritblad-PDF krijgt query-loze cache-key (signed URLs) — bump ruimt de
// oude per-URL-entries op.
// v12: nieuw app-icoon (VHB-inline op carbon) — app-icoon-PNG's/SVG gewijzigd
// onder dezelfde bestandsnamen, bump zodat cache-first het nieuwe icoon serveert.
// v13: favicon = app-icoon, én afgeronde hoeken op de tab-/app-iconen
// (vhb-icoon.svg/192/512, vhb-favicon.svg/-64.png, favicon.ico). apple-touch
// + maskable blijven vol (iOS/Android ronden die zelf). Bump = asset-wissel.
// v14: theme-color/manifest naar carbon (#0D0D0F) — manifest.json gewijzigd
// (cache-first), bump zodat de nieuwe PWA-chrome geserveerd wordt.
// v15: message-handler GET_VERSION toegevoegd (versie-indicator in Systeem-
// status); bump zodat clients de nieuwe SW oppikken.
// v16: /api/me stale-while-revalidate (koude offline start bleef hangen op
// 'Profiel laden…'), ritblad-PDF met cors-mode (geen opaque-fout meer cachen),
// notificationclick herlaadt een al-open portaal niet meer.
// v17: /api/me network-first-met-cache-fallback (SWR toonde op een gedeeld
// toestel het profiel van de vorige gebruiker); ritblad-PDF valt bij een
// cors-fout terug op no-cors zodat een koude weergave nooit breekt.
const CACHE_NAME = 'vhb-portaal-v18';
// Trage netwerken: na zoveel ms navigatie-fetch de gecachte shell tonen.
const NAV_TIMEOUT_MS = 3000;
const ME_API = '/api/me';
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

// Versie-indicator: de app vraagt via een MessageChannel naar de actieve
// cache-naam, zodat Systeem-status toont of de PWA nog op een oude SW draait.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;

  // === Ritblaadje-PDF (cross-origin storage) — cache-first + revalidate ===
  // Match op het pad-segment /ritblaadjes/ ongeacht de (Supabase-)origin.
  // Opaque responses zijn prima om in een iframe te tonen of te downloaden.
  if (url.pathname.includes(RITBLAADJE_PDF_MARKER)) {
    // Query strippen: het signed-URL-token wisselt per fetch, maar het is
    // hetzelfde PDF-bestand — één cache-entry per pad.
    const cacheKey = url.origin + url.pathname;
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(cacheKey).then((cached) => {
          // Met cors-mode i.p.v. de opaque originele request: zo is de status
          // leesbaar en cachen we alléén een echte 200. Een verlopen signed
          // URL (Supabase-400) is óók opaque en overschreef anders de goede PDF.
          const network = fetch(url.href, { mode: 'cors' })
            .then((res) => {
              if (res && res.ok) cache.put(cacheKey, res.clone());
              return res;
            })
            // Cors-fout (geen CORS-headers/redirect): gecachte PDF, of anders de
            // originele (opaque) request zodat een koude weergave nooit breekt.
            .catch(() => cached || fetch(req));
          // Cached eerst tonen (snel + offline), op achtergrond verversen.
          return cached || network;
        }),
      ),
    );
    return;
  }

  // Vanaf hier alleen same-origin.
  if (url.origin !== self.location.origin) return;

  // === Profiel (/api/me) — network-first met cache-fallback ===
  // Online altijd vers (anders toonde de stale-while-revalidate-cache op een
  // gedeeld toestel het profiel van de vorige gebruiker); offline valt hij
  // terug op het laatst gecachte profiel zodat de koude start blijft werken.
  if (url.pathname === ME_API) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.open(CACHE_NAME).then((cache) => cache.match(req)).then((c) => c || Response.error())),
    );
    return;
  }

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

  // HTML navigatie: network-first met timeout — op een traag netwerk (bus
  // onderweg) na NAV_TIMEOUT_MS de gecachte shell tonen i.p.v. op een
  // hangende fetch te blijven wachten. Zonder cache wachten we gewoon door.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      (async () => {
        const network = fetch(req).then((res) => {
          // Alleen een gezonde shell cachen — een 500/503 tijdens een deploy
          // mag de werkende offline-shell niet overschrijven.
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        });
        const slowOrDown = await Promise.race([
          network.then(() => false).catch(() => true),
          new Promise((resolve) => setTimeout(() => resolve(true), NAV_TIMEOUT_MS)),
        ]);
        if (slowOrDown) {
          const cached = (await caches.match(req)) || (await caches.match('/'));
          if (cached) return cached;
        }
        return network.catch(async () => (await caches.match(req)) || caches.match('/'));
      })(),
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
          // Alleen navigeren bij een écht ander pad — anders herlaadt een tik
          // op de melding het al-open portaal (open formulierinvoer weg).
          try {
            const target = new URL(url, self.location.origin);
            const current = new URL(win.url);
            if (target.pathname !== current.pathname || target.search !== current.search) {
              win.navigate?.(url);
            }
          } catch (_) { /* URL-parse faalt → gewoon focussen */ }
          return win.focus();
        }
      }
      return clients.openWindow(url);
    }),
  );
});
