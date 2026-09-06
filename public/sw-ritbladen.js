// Ritbladen-cache van de service worker — pure helpers, los van sw.js zodat
// ze in vitest te testen zijn (src/lib/swRitbladen.test.ts laadt dit bestand
// met een nep-`self`). Geladen in sw.js via importScripts('/sw-ritbladen.js').
//
// De cache 'vhb-ritbladen' is BUILD-ONAFHANKELIJK: hij overleeft deploys
// (activate wist alleen de build-gestempelde app-cache) en bevat:
//  - de ritblad-PDF('s) die de app na Mijn dag/dashboard aanmeldt
//    (postMessage {type:'cache-ritbladen', urls}) — hooguit MAX_RITBLADEN;
//  - de API-antwoorden die Mijn dag nodig heeft (profiel, eigen planning,
//    omleidingen, dienstnotities, ritblad-metadata) — network-first met
//    cache-fallback, zodat Mijn dag zonder bereik opent met de laatst
//    bekende gegevens. Die tellen niet mee in de snoei.
(function (root) {
  var RITBLADEN_CACHE = 'vhb-ritbladen';
  var MAX_RITBLADEN = 6;
  var RITBLAADJE_PDF_MARKER = '/ritblaadjes/';
  // Zelfde paden als de fetch-handler in sw.js; alleen GET.
  var MIJN_DAG_API = ['/api/me', '/api/planning', '/api/diversions', '/api/planning-notes', '/api/ritblaadje'];

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

  /** Same-origin API-pad dat Mijn dag nodig heeft? */
  function isMijnDagApi(pathname) {
    return MIJN_DAG_API.indexOf(pathname) !== -1;
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
    MIJN_DAG_API: MIJN_DAG_API,
    isRitbladUrl: isRitbladUrl,
    ritbladCacheKey: ritbladCacheKey,
    isMijnDagApi: isMijnDagApi,
    snoeiSleutels: snoeiSleutels,
    ritbladUrlsUitBericht: ritbladUrlsUitBericht,
  };
})(typeof self !== 'undefined' ? self : globalThis);
