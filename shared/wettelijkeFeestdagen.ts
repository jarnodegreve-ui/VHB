/**
 * Wettelijke Belgische feestdagen, berekend (vaste data + de Pasen-afgeleiden
 * via de Gauss-computus). Stond tot 20-09 in src/lib/typedag.ts; verhuisd naar
 * shared/ omdat de verlofsaldo-telling nu ook op de server draait (rapporten).
 * Volledig in UTC gerekend, dus onafhankelijk van de tijdzone van de runtime:
 * de browser (Europe/Brussels) en de functie (UTC) geven dezelfde datums.
 * Zod-vrij: dit bestand zit in de chunk-set van de startschermen.
 */

const iso = (d: Date): string =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

/** Gauss-computus: paaszondag voor een gegeven jaar (westerse kalender), als UTC-middernacht. */
const paaszondag = (jaar: number): Date => {
  const a = jaar % 19;
  const b = Math.floor(jaar / 100);
  const c = jaar % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const maand = Math.floor((h + l - 7 * m + 114) / 31); // 3 = maart, 4 = april
  const dag = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(jaar, maand - 1, dag));
};

const plusDagen = (d: Date, n: number): Date => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));

/** Wettelijke Belgische feestdagen van een jaar, als iso → naam. */
export const feestdagenVanJaar = (jaar: number): Record<string, string> => {
  const pasen = paaszondag(jaar);
  return {
    [`${jaar}-01-01`]: 'Nieuwjaar',
    [iso(plusDagen(pasen, 1))]: 'Paasmaandag',
    [`${jaar}-05-01`]: 'Dag van de Arbeid',
    [iso(plusDagen(pasen, 39))]: 'O.L.H. Hemelvaart',
    [iso(plusDagen(pasen, 50))]: 'Pinkstermaandag',
    [`${jaar}-07-21`]: 'Nationale feestdag',
    [`${jaar}-08-15`]: 'O.L.V. Hemelvaart',
    [`${jaar}-11-01`]: 'Allerheiligen',
    [`${jaar}-11-11`]: 'Wapenstilstand',
    [`${jaar}-12-25`]: 'Kerstmis',
  };
};

const feestdagCache = new Map<number, Record<string, string>>();
const feestdagenCached = (jaar: number): Record<string, string> => {
  let f = feestdagCache.get(jaar);
  if (!f) {
    f = feestdagenVanJaar(jaar);
    feestdagCache.set(jaar, f);
  }
  return f;
};

/** Naam van de feestdag op deze datum, of null. */
export const feestdagNaam = (datum: string): string | null =>
  feestdagenCached(Number(datum.slice(0, 4)))[datum] ?? null;
