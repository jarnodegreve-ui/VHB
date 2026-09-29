/**
 * Bijlagen offline (controle-ronde 29-09, nr. 2): de PDF's van omleidingen
 * en updates die iemand in de app opent, blijven na een geslaagde download
 * op het toestel staan en openen daarna ook zonder bereik.
 *
 * - **Cache** `vhb-bijlagen-v1`, los van de build (een deploy wist niets, zie
 *   activate in public/sw.js). Het versienummer in de naam is voor het
 *   formaat: verandert de sleutel of veranderen de koppen, dan gaat het
 *   nummer omhoog en gooit de service worker de oude cache in één keer weg.
 * - **Sleutel** = de URL zonder querystring. Het token in de ondertekende URL
 *   wisselt per ophaling, het pad is de plaats van het bestand.
 * - **Versie** = wat de inhoud uniek maakt (`bijlageVersie`), bewaard als kop
 *   bij het bestand. Een bijlage vervangen landt op hetzelfde pad; bij het
 *   lezen telt een andere versie als "niet bewaard" en gaat het oude bestand
 *   meteen weg, zodat nooit de vorige PDF verschijnt.
 * - **Begrenzing**: hoogstens `MAX_BIJLAGEN` bestanden en `MAX_BIJLAGEN_BYTES`
 *   in totaal, de langst niet geopende eerst weg (`teSnoeien`).
 * - **Opruimen** bij verwijderen en vervangen doet de service worker op een
 *   verse lijst van de server (public/sw-bijlagen.js); uitloggen en een
 *   gebruikerswissel wissen alle caches (`wisOfflineCaches` in ui.ts).
 *
 * Bewust alleen deze PDF-bestanden: geen API-antwoorden, geen persoonlijke
 * documenten (loonbrieven, attesten). Alles hier is best-effort: zonder Cache
 * Storage (privévenster, opslag vol) opent de bijlage gewoon, alleen niet
 * offline.
 *
 * Sleutel, versie en de namen van de koppen staan ook in
 * public/sw-bijlagen.js; src/lib/swBijlagen.test.ts bewaakt dat ze gelijk zijn.
 */

export const BIJLAGEN_CACHE = 'vhb-bijlagen-v1';
/** Een omleiding draagt tot vijf PDF's, een update twee: twintig is ruim wat
 *  iemand in een paar weken opent. */
export const MAX_BIJLAGEN = 20;
/** Eén PDF is hoogstens 3,5 MB (PDF_MAX_BYTES); 40 MB houdt de opslag van een
 *  telefoon buiten schot, ook als alle twintig plaatsen vol zitten. */
export const MAX_BIJLAGEN_BYTES = 40 * 1024 * 1024;

export const KOP_SOORT = 'X-VHB-Bijlage-Soort';
export const KOP_VERSIE = 'X-VHB-Bijlage-Versie';
export const KOP_GEBRUIKT = 'X-VHB-Bijlage-Gebruikt';
export const KOP_BYTES = 'X-VHB-Bijlage-Bytes';

export type BijlageSoort = 'omleiding' | 'update';

/** Wat de versie bepaalt; `uploadedAt` telt mee zodra de server het meegeeft. */
export type BijlageKenmerk = { filename: string; sizeBytes?: number; uploadedAt?: string };

/** Query-loze sleutel; null bij een URL die geen URL is. */
export const bijlageSleutel = (url: string): string | null => {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return null;
  }
};

/**
 * Wat de inhoud uniek maakt. Een bijlage vervangen = verwijderen en opnieuw
 * uploaden; dat kan op dezelfde plaats landen, en het record zegt dan alleen
 * via bestandsnaam en grootte dat het een ander bestand is. ASCII, want de
 * versie reist als responskop mee (een kop verdraagt geen "–" of "é").
 */
export const bijlageVersie = (b: BijlageKenmerk): string => {
  const grootte = typeof b.sizeBytes === 'number' && Number.isFinite(b.sizeBytes) ? String(b.sizeBytes) : '';
  return [encodeURIComponent(b.filename || ''), grootte, encodeURIComponent(b.uploadedAt ?? '')].join('|');
};

export type BijlageEntry = { sleutel: string; gebruiktOp: number; bytes: number };

/**
 * Begrenzing: welke sleutels moeten weg zodat er hoogstens `maxAantal`
 * bestanden en `maxBytes` overblijven? De langst niet geopende gaat eerst.
 * Het laatst geopende bestand blijft altijd staan, ook als het in zijn
 * eentje boven de grens zit.
 */
export const teSnoeien = (entries: readonly BijlageEntry[], maxAantal = MAX_BIJLAGEN, maxBytes = MAX_BIJLAGEN_BYTES): string[] => {
  const oudsteEerst = [...entries].sort((a, b) => a.gebruiktOp - b.gebruiktOp);
  let aantal = oudsteEerst.length;
  let totaal = oudsteEerst.reduce((som, e) => som + e.bytes, 0);
  const weg: string[] = [];
  for (const e of oudsteEerst) {
    if (aantal <= 1 || (aantal <= maxAantal && totaal <= maxBytes)) break;
    weg.push(e.sleutel);
    aantal -= 1;
    totaal -= e.bytes;
  }
  return weg;
};

const heeftCaches = (): boolean => typeof window !== 'undefined' && 'caches' in window;

const alsAntwoord = (bytes: Uint8Array, soort: string, versie: string, nu: number): Response =>
  // Een eigen kopie van de bytes: pdfjs neemt de buffer van de aanroeper over.
  new Response(bytes.slice(), {
    headers: {
      'Content-Type': 'application/pdf',
      [KOP_SOORT]: soort,
      [KOP_VERSIE]: versie,
      [KOP_GEBRUIKT]: String(nu),
      [KOP_BYTES]: String(bytes.byteLength),
    },
  });

/**
 * De bewaarde bytes van deze bijlage, of null als ze er niet staat. Een
 * bewaard bestand met een andere versie is het vorige bestand op dezelfde
 * plaats: dat gaat meteen weg en telt als "niet bewaard". Een treffer zet
 * het gebruiksmoment op nu (voor de begrenzing).
 */
export async function leesBijlage(sleutel: string, versie: string, nu = Date.now()): Promise<Uint8Array | null> {
  try {
    if (!heeftCaches() || !(await caches.has(BIJLAGEN_CACHE))) return null;
    const cache = await caches.open(BIJLAGEN_CACHE);
    const bewaard = await cache.match(sleutel);
    if (!bewaard) return null;
    if (bewaard.headers.get(KOP_VERSIE) !== versie) {
      await cache.delete(sleutel);
      return null;
    }
    const bytes = new Uint8Array(await bewaard.arrayBuffer());
    if (bytes.byteLength === 0) {
      await cache.delete(sleutel);
      return null;
    }
    await cache.put(sleutel, alsAntwoord(bytes, bewaard.headers.get(KOP_SOORT) ?? '', versie, nu)).catch(() => undefined);
    return bytes;
  } catch {
    return null;
  }
}

/** Na een geslaagde download bewaren en de cache begrenzen. Geeft terug of
 *  het bestand er nu staat. */
export async function bewaarBijlage(sleutel: string, soort: BijlageSoort, versie: string, bytes: Uint8Array, nu = Date.now()): Promise<boolean> {
  try {
    if (!heeftCaches()) return false;
    const cache = await caches.open(BIJLAGEN_CACHE);
    await cache.put(sleutel, alsAntwoord(bytes, soort, versie, nu));
    const entries: BijlageEntry[] = [];
    for (const verzoek of await cache.keys()) {
      const r = await cache.match(verzoek);
      if (r) entries.push({ sleutel: verzoek.url, gebruiktOp: Number(r.headers.get(KOP_GEBRUIKT)) || 0, bytes: Number(r.headers.get(KOP_BYTES)) || 0 });
    }
    await Promise.all(teSnoeien(entries).map((k) => cache.delete(k)));
    return true;
  } catch {
    // Opslag vol of geblokkeerd: de bijlage is geopend, alleen niet bewaard.
    return false;
  }
}

/** Eén bewaard bestand weghalen (het bleek geen leesbare PDF). */
export async function vergeetBijlage(sleutel: string): Promise<void> {
  try {
    if (!heeftCaches() || !(await caches.has(BIJLAGEN_CACHE))) return;
    await (await caches.open(BIJLAGEN_CACHE)).delete(sleutel);
  } catch {
    // best-effort
  }
}
