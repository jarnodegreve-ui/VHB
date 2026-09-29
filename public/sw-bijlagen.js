// Bijlagen-cache van de service worker — pure helpers, los van sw.js zodat ze
// in vitest te testen zijn (src/lib/swBijlagen.test.ts laadt dit bestand met
// een nep-`self`). Geladen in sw.js via importScripts('/sw-bijlagen.js').
//
// De cache 'vhb-bijlagen-v1' bevat de PDF-bijlagen van omleidingen en updates
// die iemand in de app geopend heeft (src/lib/bijlageCache.ts schrijft ze na
// een geslaagde download, de viewer leest ze cache-first). Hier staat alleen
// wat de service worker ermee doet:
//  - de cache is BUILD-ONAFHANKELIJK, zoals die van de ritbladen: activate
//    laat hem staan, een deploy wist geen offline PDF's;
//  - het versienummer zit in de naam. Verandert het formaat (sleutel,
//    koppen), dan gaat het nummer omhoog en gooit activate de oude cache in
//    één keer weg, want alleen de huidige naam staat op de lijst van wat blijft;
//  - opruimen: komt een VERSE lijst van omleidingen of updates van de server,
//    dan gaat elke gecachete bijlage van die soort weg die er niet meer in
//    staat (record weg, plaats weg) of die vervangen is (andere versie).
//    Nooit op basis van een lijst uit de cache of een mislukte ophaling: de
//    service worker is de enige plek die dat zeker weet, hij doet de
//    netwerkaanroep zelf.
//
// Sleutel en versie staan ook in src/lib/bijlageCache.ts (de pagina kan een
// klassiek script uit public/ niet importeren); src/lib/swBijlagen.test.ts
// bewaakt dat beide dezelfde uitkomst geven.
(function (root) {
  var BIJLAGEN_CACHE = 'vhb-bijlagen-v1';
  var KOP_SOORT = 'X-VHB-Bijlage-Soort';
  var KOP_VERSIE = 'X-VHB-Bijlage-Versie';
  var KOP_GEBRUIKT = 'X-VHB-Bijlage-Gebruikt';
  var KOP_BYTES = 'X-VHB-Bijlage-Bytes';

  /** Cache-sleutel zónder query: het token in de ondertekende URL wisselt per
   *  ophaling, het pad is de plaats van het bestand. null bij een ongeldige URL. */
  function bijlageSleutel(url) {
    try {
      var u = new URL(String(url || ''));
      return u.origin + u.pathname;
    } catch (_) {
      return null;
    }
  }

  /**
   * Wat de inhoud uniek maakt. Een bijlage vervangen = verwijderen en opnieuw
   * uploaden, en dat kan op dezelfde plaats (dus hetzelfde pad) landen; het
   * record zegt dan alleen via bestandsnaam en grootte dat het een ander
   * bestand is. `uploadedAt` telt mee zodra de server het meegeeft (vandaag
   * niet). ASCII, want de versie reist als responskop mee.
   */
  function bijlageVersie(bijlage) {
    var b = bijlage || {};
    var grootte = typeof b.sizeBytes === 'number' && isFinite(b.sizeBytes) ? String(b.sizeBytes) : '';
    var moment = typeof b.uploadedAt === 'string' ? b.uploadedAt : '';
    return [encodeURIComponent(String(b.filename || '')), grootte, encodeURIComponent(moment)].join('|');
  }

  /** Sleutel → versie van elke bijlage in een lijst records. */
  function geldigeBijlagen(lijst) {
    var geldig = {};
    for (var i = 0; i < lijst.length; i++) {
      var bijlagen = lijst[i] && Array.isArray(lijst[i].bijlagen) ? lijst[i].bijlagen : [];
      for (var j = 0; j < bijlagen.length; j++) {
        var sleutel = bijlagen[j] && bijlagen[j].url ? bijlageSleutel(bijlagen[j].url) : null;
        if (sleutel) geldig[sleutel] = bijlageVersie(bijlagen[j]);
      }
    }
    return geldig;
  }

  /**
   * Opruimregel: welke sleutels moeten weg nu deze verse lijst binnen is?
   * `entries` = wat er in de cache staat ({ sleutel, soort, versie }). Alleen
   * entries van dezelfde soort als de lijst komen in aanmerking: een lijst
   * omleidingen zegt niets over de bijlage van een update. Is `lijst` geen
   * array (foutantwoord, onverwachte vorm), dan gaat er niets weg.
   */
  function teVerwijderen(soort, entries, lijst) {
    if (!soort || !Array.isArray(lijst) || !Array.isArray(entries)) return [];
    var geldig = geldigeBijlagen(lijst);
    var weg = [];
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!e || e.soort !== soort) continue;
      if (geldig[e.sleutel] !== e.versie) weg.push(e.sleutel);
    }
    return weg;
  }

  /** Wat een gecachet antwoord over zichzelf zegt (uit de koppen). */
  function leesEntry(sleutel, response) {
    var kop = function (naam) { return (response && response.headers && response.headers.get(naam)) || ''; };
    return { sleutel: sleutel, soort: kop(KOP_SOORT), versie: kop(KOP_VERSIE), gebruiktOp: Number(kop(KOP_GEBRUIKT)) || 0, bytes: Number(kop(KOP_BYTES)) || 0 };
  }

  root.VHB_BIJLAGEN = {
    BIJLAGEN_CACHE: BIJLAGEN_CACHE,
    KOP_SOORT: KOP_SOORT,
    KOP_VERSIE: KOP_VERSIE,
    KOP_GEBRUIKT: KOP_GEBRUIKT,
    KOP_BYTES: KOP_BYTES,
    bijlageSleutel: bijlageSleutel,
    bijlageVersie: bijlageVersie,
    geldigeBijlagen: geldigeBijlagen,
    teVerwijderen: teVerwijderen,
    leesEntry: leesEntry,
  };
})(typeof self !== 'undefined' ? self : globalThis);
