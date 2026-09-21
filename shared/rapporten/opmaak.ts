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

/** Het teken vóór een benadrukte waarde op het printblad (`toonOpBlad`): nadruk mag daar nooit alleen van kleur of gewicht afhangen. */
export const NADRUK_TEKEN = '●';

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
    // Achteraan: eerst de gewone kolommen, dan die met een statuspil (`tonen`, of `nadruk` op ja/nee). De eerste kolom
    // achter het scrollen staat op de telefoon half in beeld, en een doorgesneden pil oogt slordig.
    kolommen: [eerste, ...rest.filter((k) => !k.smal), ...rest.filter((k) => k.smal === 'achteraan' && !isPilKolom(k)), ...rest.filter((k) => k.smal === 'achteraan' && isPilKolom(k))],
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

/**
 * De totaalrij van een antwoord. Twee bronnen, één regel: wat uit de rijen te
 * rekenen is volgt de definitie (`totaal`: som, kleinste, grootste, gemiddelde,
 * op de eventueel meegeleverde kolommen); wat de lader zelf meegeeft (unieke
 * chauffeurs over de hele periode, iets wat geen rij kan weten) wint per kolom.
 * Zoekt de gebruiker in de tabel, dan rekent de client opnieuw met
 * `berekenTotalen` op de zichtbare rijen en vallen de totalen van de lader weg.
 */
export const totalenVoor = (
  def: RapportDefinitie,
  rijen: readonly RapportRij[],
  extra: { kolommen?: readonly RapportKolom[] | null; vanLader?: Record<string, number> | null } = {},
): Record<string, number> => ({ ...berekenTotalen(metKolommen(def, extra.kolommen), rijen), ...(extra.vanLader ?? {}) });

/**
 * De toon van een cel volgens de definitie, of null. Eén functie voor elke
 * manier waarop een kolom een waarde laat opvallen, zodat scherm (pil, puntje
 * of gekleurd getal) en printblad (vet, met een stip) overal hetzelfde doen:
 *  - `leeg.toon`  als de waarde ontbreekt ("Geen datum")
 *  - `nadruk`     op een `janee`-kolom, alleen voor een echte boolean (een
 *                 vreemde waarde valt nooit op)
 *  - `tonen`      statustekst → toon
 *  - `signaal`    getal met een grens (resterende dagen)
 * De tekst zelf blijft `formatWaarde`, dus de CSV verandert niet.
 */
export const celToon = (kolom: RapportKolom, waarde: RapportWaarde | undefined): KolomToon | null => {
  if (waarde === null || waarde === undefined || waarde === '') return kolom.leeg?.toon ?? null;
  if (kolom.type === 'janee') return kolom.nadruk && typeof waarde === 'boolean' ? (waarde ? kolom.nadruk.ja : kolom.nadruk.nee) ?? null : null;
  if (kolom.tonen) return kolom.tonen[String(waarde)] ?? null;
  if (kolom.signaal && typeof waarde === 'number' && Number.isFinite(waarde)) {
    const { gevaarOnder, waarschuwingTot } = kolom.signaal;
    if (gevaarOnder !== undefined && waarde < gevaarOnder) return 'gevaar';
    if (waarschuwingTot !== undefined && waarde <= waarschuwingTot) return 'waarschuwing';
  }
  return null;
};

/** Vraagt deze toon aandacht? (`gevaar` en `waarschuwing`: een pil op het scherm, vet op het blad; de rest is een rusttoestand.) */
export const vraagtAandacht = (toon: KolomToon | null): boolean => toon === 'gevaar' || toon === 'waarschuwing';

/** Toont deze kolom haar toon als statuspil of -puntje (tekst en ja/nee), in plaats van als gekleurd getal of gekleurde lege tekst? */
export const isPilKolom = (kolom: RapportKolom): boolean => Boolean(kolom.tonen) || (kolom.type === 'janee' && Boolean(kolom.nadruk));

/**
 * Hoe een cel op het printblad opvalt, in zwart-wit: wat aandacht vraagt staat
 * vet, en een statuswaarde (tekst of ja/nee) krijgt er de stip voor ("● ja",
 * "● Vervallen"); een getal blijft een kaal, vet getal.
 */
export const toonOpBlad = (kolom: RapportKolom, waarde: RapportWaarde | undefined): { vet: boolean; teken: string } => {
  const toon = celToon(kolom, waarde);
  const leegMetToon = waarde === null || waarde === undefined || waarde === '';
  if (!vraagtAandacht(toon)) return { vet: false, teken: '' };
  return { vet: true, teken: isPilKolom(kolom) && !leegMetToon ? `${NADRUK_TEKEN} ` : '' };
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
