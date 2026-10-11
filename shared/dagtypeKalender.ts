import { WEEKDAG_KORT, dagtypePeriode, isDagtypeCode } from './dagtype.js';

/**
 * Dagtypekalender (verbeterronde 11-10, punt 1): per datum het De Lijn-dagtype
 * en het verlofmaximum, uit het CSV dat Jarno per jaar levert (kolommen datum,
 * weekdag, typedag, regime, dienstregeling, max_verlof). Hier staan de zuivere
 * regels die het scherm en de server delen: het bestand lezen, de rijen voor
 * de export, en de samenvatting. Geen zod, geen I/O.
 */

export type DagtypeKalenderDag = {
  /** 'JJJJ-MM-DD' */
  datum: string;
  /** De Lijn-dagtypecode ("23"). */
  typedag: string;
  /** Hoeveel chauffeurs tegelijk met verlof mogen; null = de gewone verlofinstellingen. */
  maxVerlof: number | null;
};

export type Overgeslagen = { regel: number; inhoud: string; reden: string };

/** Het regime zoals het CSV het noemt: school, vakantie, juli-augustus, examen, zaterdag, zondag, feestdag. */
export const regimeVan = (typedag: string): string => {
  const p = dagtypePeriode(typedag);
  return p === 'schooldag' ? 'school' : p === 'schoolvakantie' ? 'vakantie' : p;
};

const tekst = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

/** Een celwaarde naar 'JJJJ-MM-DD': ISO, dd/mm/jjjj, dd-mm-jjjj of een Excel-datumgetal. */
export function leesDatum(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Excel: dagen sinds 1899-12-30.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const t = tekst(v);
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(t);
  let jaar: number; let maand: number; let dag: number;
  if (m) { jaar = Number(m[1]); maand = Number(m[2]); dag = Number(m[3]); }
  else {
    m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
    if (!m) return null;
    dag = Number(m[1]); maand = Number(m[2]); jaar = Number(m[3]);
  }
  const d = new Date(Date.UTC(jaar, maand - 1, dag));
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== maand || d.getUTCDate() !== dag) return null;
  return d.toISOString().slice(0, 10);
}

const kolomIndex = (kop: readonly unknown[], ...patronen: RegExp[]): number =>
  kop.findIndex((c) => patronen.some((p) => p.test(tekst(c).toLowerCase())));

/**
 * Rijen uit het CSV (of een Excel-blad) naar kalenderdagen. De kopregel wijst
 * de kolommen aan (datum, typedag, max_verlof; de andere kolommen zijn
 * afgeleid en worden niet gelezen). Rijen die niet kloppen worden
 * overgeslagen mét reden; bij een dubbele datum wint de eerste.
 */
export function kalenderUitRijen(rijen: readonly (readonly unknown[])[]): { dagen: DagtypeKalenderDag[]; overgeslagen: Overgeslagen[] } {
  const kopRij = rijen.findIndex((r) => r.some((c) => /^datum$/i.test(tekst(c))));
  if (kopRij < 0) return { dagen: [], overgeslagen: [{ regel: 1, inhoud: tekst(rijen[0]?.join(', ')), reden: 'Geen kopregel met een kolom "datum" gevonden.' }] };
  const kop = rijen[kopRij];
  const iDatum = kolomIndex(kop, /^datum$/);
  const iType = kolomIndex(kop, /^typedag$/, /^dagtype/, /^type$/);
  const iMax = kolomIndex(kop, /verlof/);
  const overgeslagen: Overgeslagen[] = [];
  if (iType < 0) return { dagen: [], overgeslagen: [{ regel: kopRij + 1, inhoud: tekst(kop.join(', ')), reden: 'Geen kolom "typedag" gevonden.' }] };
  const dagen: DagtypeKalenderDag[] = [];
  const gezien = new Set<string>();
  rijen.forEach((rij, i) => {
    if (i <= kopRij) return;
    const regel = i + 1;
    const inhoud = rij.map(tekst).filter(Boolean).join(', ');
    if (!inhoud) return;
    const datum = leesDatum(rij[iDatum]);
    if (!datum) { overgeslagen.push({ regel, inhoud, reden: 'Geen leesbare datum.' }); return; }
    const typedag = tekst(rij[iType]);
    if (!isDagtypeCode(typedag)) { overgeslagen.push({ regel, inhoud, reden: `Onbekend dagtype “${typedag}”.` }); return; }
    let maxVerlof: number | null = null;
    if (iMax >= 0) {
      const raw = tekst(rij[iMax]);
      if (raw) {
        const n = Number(raw.replace(',', '.'));
        if (!Number.isInteger(n) || n < 0 || n > 200) { overgeslagen.push({ regel, inhoud, reden: `Verlofmaximum “${raw}” is geen geheel getal tussen 0 en 200.` }); return; }
        maxVerlof = n;
      }
    }
    if (gezien.has(datum)) { overgeslagen.push({ regel, inhoud, reden: 'Dubbele datum, de eerste rij telt.' }); return; }
    gezien.add(datum);
    dagen.push({ datum, typedag, maxVerlof });
  });
  dagen.sort((a, b) => a.datum.localeCompare(b.datum));
  return { dagen, overgeslagen };
}

/** Weekdag van een ISO-dag, kort ("wo"). */
export const weekdagKortVan = (datum: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datum);
  if (!m) return '';
  return WEEKDAG_KORT[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
};

/** De rijen voor de CSV-export, in het formaat van het bestand van Jarno. */
export const kalenderRijen = (dagen: readonly DagtypeKalenderDag[]): unknown[][] => [
  ['datum', 'weekdag', 'typedag', 'regime', 'dienstregeling', 'max_verlof'],
  ...dagen.map((d) => [d.datum, weekdagKortVan(d.datum), d.typedag, regimeVan(d.typedag), d.typedag === '28' ? '27' : d.typedag, d.maxVerlof ?? '']),
];

/** Voor dagtypeVanDag: per datum de code en het maximum; undefined zonder dagen. */
export const perDagVan = (dagen: readonly DagtypeKalenderDag[]): Record<string, { typedag: string; maxVerlof: number | null }> | undefined =>
  dagen.length > 0 ? Object.fromEntries(dagen.map((d) => [d.datum, { typedag: d.typedag, maxVerlof: d.maxVerlof }])) : undefined;

export type KalenderSamenvatting = { aantal: number; eerste: string | null; laatste: string | null; perRegime: Array<{ regime: string; aantal: number }> };

/** Telling per regime, in een vaste volgorde. */
export function samenvatting(dagen: readonly DagtypeKalenderDag[]): KalenderSamenvatting {
  const volgorde = ['school', 'vakantie', 'juli-augustus', 'examen', 'zaterdag', 'zondag', 'feestdag'];
  const tel = new Map<string, number>();
  for (const d of dagen) tel.set(regimeVan(d.typedag), (tel.get(regimeVan(d.typedag)) ?? 0) + 1);
  return {
    aantal: dagen.length,
    eerste: dagen[0]?.datum ?? null,
    laatste: dagen[dagen.length - 1]?.datum ?? null,
    perRegime: volgorde.filter((r) => tel.has(r)).map((regime) => ({ regime, aantal: tel.get(regime)! })),
  };
}
