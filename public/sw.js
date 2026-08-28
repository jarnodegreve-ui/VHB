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
// v19: vhb-logo-wit.svg (oude lockup mét "Van Hoorebeke & Zoon") verwijderd —
// de pre-app-schermen gebruiken nu hetzelfde logo als login/sidebar. Bump
// zodat toestellen het oude bestand niet uit de cache blijven serveren.
// v20: overal de primary-lockup (vhb-logo-primair(-wit).svg, mét naamregel);
// de sidebar-varianten zonder naamregel zijn verwijderd.
// v21: primair-lockup herbalanceerd (monogram 14% kleiner, meer lucht boven
// de naamregel) — zelfde bestandsnamen, dus bump om de oude uit cache te duwen.
// v22: shape-rendering uit de primair-logo's (WebKit rendert 'auto' strakker)
// — zelfde bestandsnamen, dus bump om de oude uit cache te duwen.
// v23: hele dagoplevering 03/04-08 (ziekte-keten, dashboard, dekking) — een
// standalone PWA die uit de app-switcher hervat doet géén navigatie-fetch en
// herlaadt alleen op controllerchange, en die vuurt alleen als sw.js zélf
// wijzigt. Bump dus bij elke betekenisvolle release, ook zonder sw-wijziging.
// Sinds 06-08: de versie wordt bij élke build gestempeld — vite.config.ts
// vervangt __VHB_BUILD_ID__ door de commit-SHA (of buildtijd). Handmatig
// bumpen hoeft niet meer: elke deploy wijzigt sw.js zelf en triggert dus de
// SW-update; het terugkerende "14 releases zonder bump"-gat kan niet meer.
// (In `vite dev` blijft de placeholder staan — daar is geen SW-cache-zorg.)
const CACHE_NAME = 'vhb-portaal-__VHB_BUILD_ID__';
// Trage netwerken: na zoveel ms navigatie-fetch de gecachte shell tonen.
const NAV_TIMEOUT_MS = 3000;
const ME_API = '/api/me';
const RITBLAADJE_API = '/api/ritblaadje';
const PLANNING_API = '/api/planning';
const RITBLAADJE_PDF_MARKER = '/ritblaadjes/';

self.addEventListener('install', (event) => {
  // GEEN automatische skipWaiting meer: sinds de build-stempel is er bij
  // élke deploy een nieuwe SW, en skipWaiting + de controllerchange-reload
  // in index.html herlaadde de app dan hard — ook midden in een half
  // ingevuld verlof- of ruilformulier. De nieuwe SW wacht nu netjes tot de
  // gebruiker via de "Vernieuw"-knop toestemming geeft (message
  // SKIP_WAITING hieronder) of tot alle vensters dicht zijn.
  //
  // Wél de shell alvast in de nieuwe cache zetten: index.html plus de assets
  // die hij direct laadt (entry-chunk, css, modulepreloads). Zonder dat stond
  // de nieuwe cache leeg tot de eerste geslaagde navigatie, terwijl activate
  // de oude cache al wiste — "Vernieuw" zonder netwerk gaf zo een wit scherm
  // (controle-ronde 27-08, bevinding 6). Best-effort: mislukt de precache
  // (offline), dan houdt activate de oude cache aan.
  event.waitUntil(precacheShell().catch(() => {}));
});

async function precacheShell() {
  const cache = await caches.open(CACHE_NAME);
  const res = await fetch(new Request('/', { cache: 'reload' }));
  if (!res.ok) return;
  const html = await res.clone().text();
  await cache.put('/', res);
  const assets = [...new Set(html.match(/\/assets\/[A-Za-z0-9._-]+/g) || [])];
  await Promise.all(
    assets.map((pad) =>
      fetch(new Request(pad, { cache: 'reload' }))
        .then((r) => (r.ok ? cache.put(pad, r) : null))
        .catch(() => null),
    ),
  );
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Oude caches pas wissen als de nieuwe een shell heeft. Anders (precache
      // mislukt, bv. offline) blijven ze staan: caches.match() zoekt over álle
      // caches, dus de oude shell blijft bruikbaar tot de volgende activate.
      const cache = await caches.open(CACHE_NAME);
      const heeftShell = Boolean(await cache.match('/'));
      if (heeftShell) {
        const keys = await caches.keys();
        await Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)));
      }
      await self.clients.claim();
    })(),
  );
});

// Gehashte assets stapelen op binnen dezelfde cache-naam: elke deploy levert
// nieuwe bestandsnamen, en zolang CACHE_NAME gelijk blijft ruimt de
// activate-stap hierboven ze niet op — die wist alleen ándere cachenamen. Een
// bump is er bewust niet bij elke deploy, dus zonder plafond blijven de chunks
// van élke tussenliggende versie voorgoed staan.
//
// De Cache API geeft keys in invoegvolgorde terug, dus de oudste vallen er als
// eerste af. 120 entries ≈ acht deploys aan assets; ruim genoeg om offline te
// blijven werken, en wie zoveel versies verzamelde draait allang op nieuwere
// bestanden.
const MAX_ASSET_ENTRIES = 120;
let trimBezig = false;
function trimAssetCache(cache) {
  if (trimBezig) return Promise.resolve();
  trimBezig = true;
  return cache
    .keys()
    .then((keys) => {
      const assets = keys.filter((r) => {
        try {
          return new URL(r.url).pathname.startsWith('/assets/');
        } catch {
          return false;
        }
      });
      const overschot = assets.length - MAX_ASSET_ENTRIES;
      if (overschot <= 0) return;
      return Promise.all(assets.slice(0, overschot).map((r) => cache.delete(r)));
    })
    .catch(() => { /* opruimen mag nooit een fetch laten falen */ })
    .then(() => { trimBezig = false; });
}

// Versie-indicator: de app vraagt via een MessageChannel naar de actieve
// cache-naam, zodat Systeem-status toont of de PWA nog op een oude SW draait.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'GET_VERSION' && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: CACHE_NAME });
  }
  // De gebruiker koos "Vernieuw" in de update-toast: nú pas activeren.
  // De controllerchange-listener in index.html doet daarna de herlaad.
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
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

  // === Profiel (/api/me) + rooster (/api/planning) — network-first ===
  // Online altijd vers, offline terugvallen op de laatst gecachte versie zodat
  // de koude start blijft werken.
  //
  // /api/me stond hier al (stale-while-revalidate toonde op een gedeeld
  // toestel het profiel van de vorige gebruiker). /api/planning is gevolgd om
  // dezelfde reden: met SWR kreeg je eerst de gecachte body en pas bij een
  // vólgende fetch de verse, dus het rooster liep structureel één generatie
  // achter — ook na een pull-to-refresh en zelfs na een harde reload. Sinds een
  // goedgekeurde ruil de planning echt doorvoert, is dat niet cosmetisch meer:
  // de chauffeur zag dan nog zijn oude dienst. Een dienst is te belangrijk om
  // uit een oude cache te serveren.
  if (url.pathname === ME_API || url.pathname === PLANNING_API) {
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

  // === Ritblaadje-metadata — stale-while-revalidate ===
  // Keyed op de volledige URL (incl. query), dus per gebruiker/dag apart.
  // Blijft bewust SWR: metadata die zelden wijzigt en waar een generatie
  // vertraging niemand schaadt.
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
          caches.open(CACHE_NAME).then((cache) =>
            cache.put(req, copy).then(() => trimAssetCache(cache)),
          );
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
