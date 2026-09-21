import type { KolomNadruk, RapportDefinitie, RapportKolom, RapportRij, RapportWaarde } from './types.js';

/**
 * Eén opmaak per kolomtype, gedeeld door de tabel op het scherm, het
 * printblad en de CSV. Zod-vrij en zonder DOM, dus ook de server kan ermee
 * tellen (totalen in het antwoord).
 */

/** Minuten → 'u:mm' (125 → '2:05', -30 → '-0:30'); uren lopen door boven 24. */
export const formatDuur = (minuten: number): string => {
  const m = Math.round(Math.abs(minuten));
  return `${minuten < 0 && m > 0 ? '-' : ''}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

/** Getal met decimale komma en hoogstens twee decimalen (12,5). Geen duizendtallen: een CSV moet een getal blijven. */
export const formatAantal = (n: number): string => String(Math.round(n * 100) / 100).replace('.', ',');

const dmj = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

export const isGetalKolom = (k: RapportKolom): boolean => k.type === 'getal' || k.type === 'duur';
export const isRechts = (k: RapportKolom): boolean => (k.uitlijning ? k.uitlijning === 'rechts' : isGetalKolom(k));

/**
 * Waarde → tekst. `doel: 'csv'` houdt datums in ISO (machineleesbaar, zoals
 * elke export in het portaal) en geeft een lege cel in plaats van een streep.
 * Nul blijft "0" (of "0:00"): een rapport verzwijgt geen nul.
 */
export const formatWaarde = (kolom: RapportKolom, waarde: RapportWaarde | undefined, doel: 'beeld' | 'csv' = 'beeld'): string => {
  const leeg = doel === 'csv' ? '' : '—';
  if (waarde === null || waarde === undefined || waarde === '') return leeg;
  switch (kolom.type) {
    case 'datum': return doel === 'csv' ? String(waarde).slice(0, 10) : dmj(String(waarde));
    case 'getal': return typeof waarde === 'number' && Number.isFinite(waarde) ? formatAantal(waarde) : String(waarde);
    case 'duur': return typeof waarde === 'number' && Number.isFinite(waarde) ? formatDuur(waarde) : String(waarde);
    case 'janee': return waarde === true ? 'ja' : waarde === false ? 'nee' : String(waarde);
    case 'tekst': return String(waarde);
  }
};

/**
 * De nadruk van een cel, of null: alleen een `janee`-kolom met `nadruk`, en
 * alleen voor een echte boolean (een lege of vreemde waarde valt nooit op).
 * Scherm (pil) en printblad (vet met een stip) lezen allebei deze functie; de
 * tekst zelf blijft `formatWaarde`, dus de CSV verandert niet.
 */
export const nadrukVan = (kolom: RapportKolom, waarde: RapportWaarde | undefined): KolomNadruk | null => {
  if (kolom.type !== 'janee' || !kolom.nadruk || typeof waarde !== 'boolean') return null;
  return (waarde ? kolom.nadruk.ja : kolom.nadruk.nee) ?? null;
};

/** Het teken vóór een benadrukte waarde op het printblad: nadruk mag daar nooit alleen van kleur of gewicht afhangen. */
export const NADRUK_TEKEN = '●';

/**
 * Welke kolommen de tabel op het scherm toont. Breed (en overal buiten het
 * scherm: printblad, CSV) zijn dat alle kolommen in de volgorde van de
 * definitie. Smal volgt de rol `smal` van elke kolom: `onderEerste` wordt een
 * regel onder de eerste kolom, `achteraan` schuift naar het einde (achter het
 * horizontaal scrollen), `verberg` valt weg. De eerste kolom blijft altijd
 * de eerste, wat haar rol ook zegt.
 */
export type KolomIndeling = { kolommen: RapportKolom[]; onderEerste: RapportKolom[] };
export const kolomIndeling = (def: RapportDefinitie, breedte: 'smal' | 'breed'): KolomIndeling => {
  if (breedte === 'breed') return { kolommen: [...def.kolommen], onderEerste: [] };
  const [eerste, ...rest] = def.kolommen;
  if (!eerste) return { kolommen: [], onderEerste: [] };
  return {
    kolommen: [eerste, ...rest.filter((k) => !k.smal), ...rest.filter((k) => k.smal === 'achteraan')],
    onderEerste: rest.filter((k) => k.smal === 'onderEerste'),
  };
};

/** De regel onder de eerste kolom: de opgemaakte waarden van de `onderEerste`-kolommen, lege overgeslagen. */
export const onderEersteTekst = (onderEerste: readonly RapportKolom[], rij: RapportRij): string =>
  onderEerste
    .filter((k) => rij[k.id] !== null && rij[k.id] !== undefined && rij[k.id] !== '')
    .map((k) => formatWaarde(k, rij[k.id]))
    .join(' · ');

/**
 * De definitie met de kolommen van het antwoord erin. Een rapport waarvan de
 * kolommen van de gegevens afhangen (één kolom per verloftype dat voorkomt)
 * levert ze mee; al wat kolommen leest (tabel, blad, CSV, zoeken, totalen)
 * krijgt deze definitie in plaats van de kale. Zonder meegeleverde kolommen
 * is het gewoon dezelfde definitie (zelfde object, dus geen herberekening).
 */
export const metKolommen = (def: RapportDefinitie, kolommen?: readonly RapportKolom[] | null): RapportDefinitie =>
  (kolommen && kolommen.length > 0 ? { ...def, kolommen } : def);

/** Som per optelbare kolom; een kolom zonder één getal telt als 0. */
export const berekenTotalen = (def: RapportDefinitie, rijen: readonly RapportRij[]): Record<string, number> => {
  const uit: Record<string, number> = {};
  for (const k of def.kolommen) {
    if (!k.totaal || !isGetalKolom(k)) continue;
    uit[k.id] = rijen.reduce((som, rij) => {
      const w = rij[k.id];
      return typeof w === 'number' && Number.isFinite(w) ? som + w : som;
    }, 0);
  }
  return uit;
};

export const heeftTotaalrij = (def: RapportDefinitie): boolean => def.kolommen.some((k) => k.totaal && isGetalKolom(k));

/** Sorteerwaarde: getallen als getal, ja/nee als 1/0, de rest als tekst (ISO-datums sorteren vanzelf goed). */
export const sorteerWaarde = (kolom: RapportKolom, waarde: RapportWaarde | undefined): string | number | null => {
  if (waarde === null || waarde === undefined || waarde === '') return null;
  if (typeof waarde === 'boolean') return waarde ? 1 : 0;
  if (isGetalKolom(kolom)) return typeof waarde === 'number' ? waarde : Number(waarde);
  return String(waarde);
};

export const sorteerRijen = (def: RapportDefinitie, rijen: readonly RapportRij[], kolomId: string, richting: 'asc' | 'desc'): RapportRij[] => {
  const kolom = def.kolommen.find((k) => k.id === kolomId) ?? def.kolommen[0];
  const f = richting === 'asc' ? 1 : -1;
  // `sorteerOp`: de kolom toont "Augustus 2026" maar sorteert op '2026-08'.
  // Dat veld is geen kolom, dus het vergelijkt als wat het is (getal of tekst).
  const waarde = (rij: RapportRij) => (kolom.sorteerOp ? rij[kolom.sorteerOp] ?? null : sorteerWaarde(kolom, rij[kolom.id]));
  return [...rijen].sort((a, b) => {
    const va = waarde(a);
    const vb = waarde(b);
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * f;
    return String(va).localeCompare(String(vb), 'nl', { numeric: true, sensitivity: 'base' }) * f;
  });
};

/** Bevat deze rij de zoekterm? (in de opgemaakte tekst van om het even welke kolom) */
export const rijBevat = (def: RapportDefinitie, rij: RapportRij, zoekterm: string): boolean => {
  const q = zoekterm.trim().toLowerCase();
  if (!q) return true;
  return def.kolommen.some((k) => formatWaarde(k, rij[k.id], 'csv').toLowerCase().includes(q));
};

/**
 * De cellen van de CSV: kopregel, de rijen en (als de definitie er één heeft)
 * de totaalrij. Nog geen tekst: het escapen en de formule-guard zitten in
 * src/lib/csv.ts (`csvTekst`), die hier bewust niet gedupliceerd wordt.
 */
export const csvRijen = (def: RapportDefinitie, rijen: readonly RapportRij[], totalen?: Record<string, number> | null): string[][] => {
  const uit: string[][] = [def.kolommen.map((k) => k.titel)];
  for (const rij of rijen) uit.push(def.kolommen.map((k) => formatWaarde(k, rij[k.id], 'csv')));
  if (totalen && heeftTotaalrij(def) && rijen.length > 0) {
    uit.push(def.kolommen.map((k, i) => (k.id in totalen ? formatWaarde(k, totalen[k.id], 'csv') : i === 0 ? 'Totaal' : '')));
  }
  return uit;
};
