import type { KolomToon, RapportDefinitie, RapportKolom, RapportRij, RapportWaarde, TotaalSoort } from './types.js';

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
export const formatAantal = (n: number, decimalen?: number): string =>
  (decimalen === undefined ? String(Math.round(n * 100) / 100) : n.toFixed(decimalen)).replace('.', ',');

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
  const leeg = doel === 'csv' ? '' : kolom.leeg?.tekst ?? '—';
  if (waarde === null || waarde === undefined || waarde === '') return leeg;
  switch (kolom.type) {
    case 'datum': return doel === 'csv' ? String(waarde).slice(0, 10) : dmj(String(waarde));
    case 'getal': return typeof waarde === 'number' && Number.isFinite(waarde) ? formatAantal(waarde, kolom.decimalen) : String(waarde);
    case 'duur': return typeof waarde === 'number' && Number.isFinite(waarde) ? formatDuur(waarde) : String(waarde);
    case 'janee': return waarde === true ? 'ja' : waarde === false ? 'nee' : String(waarde);
    case 'tekst': return String(waarde);
  }
};

/**
 * Welke kolommen de tabel op het scherm toont. Breed (en overal buiten het
 * scherm: printblad, CSV) zijn dat alle kolommen in de volgorde van de
 * definitie. Smal volgt de rol `smal` van elke kolom: `onderEerste` wordt een
 * regel onder de eerste kolom, `achteraan` schuift naar het einde (achter het
 * horizontaal scrollen; statuskolommen met een pil als allerlaatste), `verberg` valt weg. De eerste kolom blijft altijd
 * de eerste, wat haar rol ook zegt.
 */
export type KolomIndeling = { kolommen: RapportKolom[]; onderEerste: RapportKolom[] };
export const kolomIndeling = (def: RapportDefinitie, breedte: 'smal' | 'breed'): KolomIndeling => {
  if (breedte === 'breed') return { kolommen: [...def.kolommen], onderEerste: [] };
  const [eerste, ...rest] = def.kolommen;
  if (!eerste) return { kolommen: [], onderEerste: [] };
  return {
    // Achteraan: eerst de gewone kolommen, dan die met een statuspil (`tonen`). De eerste kolom
    // achter het scrollen staat op de telefoon half in beeld, en een doorgesneden pil oogt slordig.
    kolommen: [eerste, ...rest.filter((k) => !k.smal), ...rest.filter((k) => k.smal === 'achteraan' && !k.tonen), ...rest.filter((k) => k.smal === 'achteraan' && k.tonen)],
    onderEerste: rest.filter((k) => k.smal === 'onderEerste'),
  };
};

/** De regel onder de eerste kolom: de opgemaakte waarden van de `onderEerste`-kolommen, lege overgeslagen. */
export const onderEersteTekst = (onderEerste: readonly RapportKolom[], rij: RapportRij): string =>
  onderEerste
    .filter((k) => rij[k.id] !== null && rij[k.id] !== undefined && rij[k.id] !== '')
    .map((k) => formatWaarde(k, rij[k.id]))
    .join(' · ');

/** Hoe deze kolom in de totaalrij telt, of null als ze er niet in staat. */
export const totaalSoort = (k: RapportKolom): TotaalSoort | null =>
  !k.totaal || !isGetalKolom(k) ? null : k.totaal === true ? 'som' : k.totaal;

const getal = (w: RapportWaarde | undefined): number | null => (typeof w === 'number' && Number.isFinite(w) ? w : null);

/**
 * De totaalrij. Een som zonder één getal is 0 (een rapport verzwijgt geen
 * nul); kleinste, grootste en gemiddelde hebben dan geen waarde en ontbreken
 * in het resultaat, zodat de cel leeg blijft in plaats van een verzonnen 0.
 * Een gemiddelde weegt met `totaalGewicht` (groepsrijen: het gemiddelde van
 * de vloot is niet het gemiddelde van de groepsgemiddelden).
 */
export const berekenTotalen = (def: RapportDefinitie, rijen: readonly RapportRij[]): Record<string, number> => {
  const uit: Record<string, number> = {};
  for (const k of def.kolommen) {
    const soort = totaalSoort(k);
    if (!soort) continue;
    if (soort === 'som') { uit[k.id] = rijen.reduce((som, rij) => som + (getal(rij[k.id]) ?? 0), 0); continue; }
    let teller = 0;
    let noemer = 0;
    let uiterste: number | null = null;
    for (const rij of rijen) {
      const w = getal(rij[k.id]);
      if (w === null) continue;
      if (soort === 'gemiddelde') {
        const gewicht = k.totaalGewicht ? Math.max(0, getal(rij[k.totaalGewicht]) ?? 0) : 1;
        teller += w * gewicht;
        noemer += gewicht;
      } else if (uiterste === null || (soort === 'min' ? w < uiterste : w > uiterste)) uiterste = w;
    }
    if (soort === 'gemiddelde') { if (noemer > 0) uit[k.id] = teller / noemer; } else if (uiterste !== null) uit[k.id] = uiterste;
  }
  return uit;
};

export const heeftTotaalrij = (def: RapportDefinitie): boolean => def.kolommen.some((k) => totaalSoort(k) !== null);

/** De toon van een cel volgens de definitie (`tonen` voor een statustekst, `signaal` voor een getal met een grens, `leeg.toon` als de waarde ontbreekt), of null. */
export const celToon = (kolom: RapportKolom, waarde: RapportWaarde | undefined): KolomToon | null => {
  if (waarde === null || waarde === undefined || waarde === '') return kolom.leeg?.toon ?? null;
  if (kolom.tonen) return kolom.tonen[String(waarde)] ?? null;
  if (kolom.signaal && typeof waarde === 'number' && Number.isFinite(waarde)) {
    const { gevaarOnder, waarschuwingTot } = kolom.signaal;
    if (gevaarOnder !== undefined && waarde < gevaarOnder) return 'gevaar';
    if (waarschuwingTot !== undefined && waarde <= waarschuwingTot) return 'waarschuwing';
  }
  return null;
};

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
  return [...rijen].sort((a, b) => {
    const va = sorteerWaarde(kolom, a[kolom.id]);
    const vb = sorteerWaarde(kolom, b[kolom.id]);
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
