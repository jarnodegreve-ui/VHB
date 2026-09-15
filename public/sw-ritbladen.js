// Ritbladen-cache van de service worker — pure helpers, los van sw.js zodat
// ze in vitest te testen zijn (src/lib/swRitbladen.test.ts laadt dit bestand
// met een nep-`self`). Geladen in sw.js via importScripts('/sw-ritbladen.js').
//
// De cache 'vhb-ritbladen' is BUILD-ONAFHANKELIJK: hij overleeft deploys
// (activate wist alleen de build-gestempelde app-cache) en bevat:
//  - de ritblad-PDF('s) die de app na Mijn dag/dashboard aanmeldt
//    (postMessage {type:'cache-ritbladen', urls}) — hooguit MAX_RITBLADEN;
//  - de API-antwoorden die de koude offline start nodig heeft (profiel,
//    eigen planning, omleidingen, dienstnotities, ritblad-metadata, en
//    sinds punt 19 (15-09) ook gebruikerslijst, updates, dienstruilen,
//    verlof en meldingen) — network-first met cache-fallback, zodat Mijn dag
//    zonder bereik opent met de laatst bekende gegevens én de startlading
//    (loadAppData) geen rode toast met zes bronnen geeft. Die tellen niet
//    mee in de snoei. Een antwoord uit de cache krijgt de header
//    `X-VHB-Bron: cache` (markeerUitCache), zodat de app weet dat "geladen"
//    niet "vers" is.
(function (root) {
  var RITBLADEN_CACHE = 'vhb-ritbladen';
  var MAX_RITBLADEN = 6;
  var RITBLAADJE_PDF_MARKER = '/ritblaadjes/';
  var CACHE_BRON_HEADER = 'X-VHB-Bron';
  // Zelfde paden als de fetch-handler in sw.js; alleen GET, exact pad (geen
  // subpaden zoals /api/planning/assign-service). Per gebruiker gesleuteld
  // op de volledige URL; uitloggen/gebruikerswissel wist alle caches (ui.ts).
  // /api/users zit erbij: de lijst is klein (±100 rijen, tientallen kB) en
  // voedt de contacten en de ruil-badge ("Geruild met X").
  var OFFLINE_API = [
    '/api/me', '/api/planning', '/api/diversions', '/api/planning-notes', '/api/ritblaadje',
    '/api/users', '/api/updates', '/api/swaps', '/api/leave', '/api/meldingen',
  ];

  /** Is dit de (ondertekende) storage-URL van een ritblad-bundel? */
  function isRitbladUrl(url) {
    try {
      return new URL(url).pathname.indexOf(RITBLAADJE_PDF_MARKER) !== -1;
    } catch (_) {
      return false;
    }
  }

  /** Cache-sleutel zónder query: het signed-URL-token wisselt per fetch,
   *  maar het is hetzelfde bestand — één entry per pad. */
  function ritbladCacheKey(url) {
    var u = new URL(url);
    return u.origin + u.pathname;
  }

  /** Same-origin API-pad dat offline uit de cache mag komen? */
  function isOfflineApi(pathname) {
    return OFFLINE_API.indexOf(pathname) !== -1;
  }

  /**
   * Gecacht antwoord markeren als "uit de cache": zelfde status, body en
   * headers (incl. de oorspronkelijke Date, waarmee de app de versheid
   * toont), plus `X-VHB-Bron: cache`. De headers van een Cache-match zijn
   * onveranderlijk, vandaar een nieuwe Response. null/undefined blijft null.
   */
  function markeerUitCache(response) {
    if (!response) return null;
    var headers = new Headers(response.headers);
    headers.set(CACHE_BRON_HEADER, 'cache');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
  }

  /**
   * Snoei: welke sleutels moeten weg zodat er hooguit `max` ritblad-PDF's
   * overblijven? `keys` in cache-volgorde (oudste eerst — Cache.keys() geeft
   * de invoegvolgorde); API-antwoorden tellen niet mee en blijven staan.
   * Geeft de te verwijderen sleutels (oudste eerst).
   */
  function snoeiSleutels(keys, max) {
    var limiet = typeof max === 'number' ? max : MAX_RITBLADEN;
    var pdfs = [];
    for (var i = 0; i < keys.length; i++) {
      var k = typeof keys[i] === 'string' ? keys[i] : keys[i].url;
      if (isRitbladUrl(k)) pdfs.push(k);
    }
    var teveel = pdfs.length - limiet;
    return teveel > 0 ? pdfs.slice(0, teveel) : [];
  }

  /** URL-lijst uit een cache-ritbladen-bericht: alleen geldige ritblad-URL's, uniek per sleutel. */
  function ritbladUrlsUitBericht(data) {
    var urls = data && Array.isArray(data.urls) ? data.urls : [];
    var gezien = {};
    var uit = [];
    for (var i = 0; i < urls.length; i++) {
      var u = String(urls[i] || '');
      if (!isRitbladUrl(u)) continue;
      var key = ritbladCacheKey(u);
      if (gezien[key]) continue;
      gezien[key] = true;
      uit.push({ url: u, key: key });
    }
    return uit;
  }

  root.VHB_RITBLADEN = {
    RITBLADEN_CACHE: RITBLADEN_CACHE,
    MAX_RITBLADEN: MAX_RITBLADEN,
    OFFLINE_API: OFFLINE_API,
    CACHE_BRON_HEADER: CACHE_BRON_HEADER,
    isRitbladUrl: isRitbladUrl,
    ritbladCacheKey: ritbladCacheKey,
    isOfflineApi: isOfflineApi,
    markeerUitCache: markeerUitCache,
    snoeiSleutels: snoeiSleutels,
    ritbladUrlsUitBericht: ritbladUrlsUitBericht,
  };
})(typeof self !== 'undefined' ? self : globalThis);
