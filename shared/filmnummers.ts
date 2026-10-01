/**
 * Filmnummers (01-10): het nummer dat een chauffeur op het bedieningstoestel
 * intoetst om de juiste bestemming op de buitenkant van de bus te tonen. Eén
 * lijst voor het hele bedrijf (code, lijn, tekst op de film), opgeslagen als
 * één jsonb-waarde in app_settings, dus zonder migratie. Een admin vervangt
 * ze in één keer met een import (CSV of Excel); de chauffeurs lezen alleen.
 *
 * Zod-vrij: het scherm Filmnummers leest alleen deze types en lezers, zodat
 * een chauffeur er geen zod-vendor voor laadt. Het schema voor de PUT-body
 * staat in shared/schemas/filmnummers.ts en rekent met dezelfde grenzen.
 */

export const FILMNUMMERS_KEY = 'filmnummers';

/** Wat je intoetst: alleen cijfers. Als tekst bewaard, zoals in het bestand. */
export const FILMNUMMER_CODE = /^\d{1,6}$/;
export const MAX_FILMNUMMERS = 1000;
export const MAX_FILM_LIJN = 12;
export const MAX_FILM_TEKST = 120;

export type Filmnummer = {
  code: string;
  /** Lijnnummer, of '' voor een algemene boodschap (Geen dienst, Stelplaats). */
  lijn: string;
  /** De bestemming of boodschap die de film toont. */
  tekst: string;
};

export type FilmnummerLijst = {
  items: Filmnummer[];
  /** Wanneer de lijst het laatst vervangen is (ISO), null zolang er geen is. */
  bijgewerktOp: string | null;
};

export const LEGE_FILMNUMMERLIJST: FilmnummerLijst = { items: [], bijgewerktOp: null };

/** Cel uit een bestand of een opgeslagen waarde → één regel tekst. */
export const filmTekst = (waarde: unknown): string => String(waarde ?? '').replace(/\s+/g, ' ').trim();

/** Onbekende invoer → een geldig filmnummer, of null als code of tekst niet klopt. */
export const leesFilmnummer = (ruw: unknown): Filmnummer | null => {
  if (!ruw || typeof ruw !== 'object') return null;
  const r = ruw as Record<string, unknown>;
  const code = filmTekst(r.code);
  const lijn = filmTekst(r.lijn);
  const tekst = filmTekst(r.tekst);
  if (!FILMNUMMER_CODE.test(code) || !tekst || tekst.length > MAX_FILM_TEKST || lijn.length > MAX_FILM_LIJN) return null;
  return { code, lijn, tekst };
};

const opNummer = (a: string, b: string): number => Number(a) - Number(b) || a.localeCompare(b);

/**
 * De lijst zoals ze bewaard en getoond wordt: alleen geldige nummers, elke
 * code één keer (de eerste regel wint) en oplopend op code, zoals de papieren
 * lijst.
 */
export function normaliseerFilmnummers(ruw: readonly unknown[]): Filmnummer[] {
  const perCode = new Map<string, Filmnummer>();
  for (const rij of ruw) {
    const f = leesFilmnummer(rij);
    if (f && !perCode.has(f.code)) perCode.set(f.code, f);
  }
  return [...perCode.values()].sort((a, b) => opNummer(a.code, b.code));
}

/** Onbekende invoer (jsonb uit de database, kopie op het toestel) → geldige lijst, anders leeg. */
export const parseFilmnummerLijst = (waarde: unknown): FilmnummerLijst => {
  if (!waarde || typeof waarde !== 'object') return LEGE_FILMNUMMERLIJST;
  const w = waarde as { items?: unknown; bijgewerktOp?: unknown };
  if (!Array.isArray(w.items)) return LEGE_FILMNUMMERLIJST;
  const op = typeof w.bijgewerktOp === 'string' && !Number.isNaN(Date.parse(w.bijgewerktOp)) ? w.bijgewerktOp : null;
  return { items: normaliseerFilmnummers(w.items.slice(0, MAX_FILMNUMMERS)), bijgewerktOp: op };
};

const opLijn = (a: string, b: string): number => a.localeCompare(b, 'nl', { numeric: true });

export type FilmnummerIndeling = {
  /** De lijnen die in de lijst voorkomen, oplopend (50, 56, 621, …, G12, G50). */
  lijnen: string[];
  /** Bestemmingen: per lijn bij elkaar, binnen een lijn oplopend op nummer. */
  bestemmingen: Filmnummer[];
  /** Boodschappen zonder lijn (Geen dienst, Stelplaats), oplopend op nummer. */
  algemeen: Filmnummer[];
};

/**
 * Bestemmingen en algemene boodschappen apart: onderweg zoekt een chauffeur
 * vooral de bestemmingen van zijn lijn, die staan dus samen en vooraan.
 */
export function verdeelFilmnummers(items: readonly Filmnummer[]): FilmnummerIndeling {
  const bestemmingen = items
    .filter((f) => f.lijn !== '')
    .sort((a, b) => opLijn(a.lijn, b.lijn) || opNummer(a.code, b.code));
  return {
    lijnen: [...new Set(bestemmingen.map((f) => f.lijn))],
    bestemmingen,
    algemeen: items.filter((f) => f.lijn === '').sort((a, b) => opNummer(a.code, b.code)),
  };
}

const plat = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Zoeken op lijn, bestemming of nummer; elk woord moet ergens raken. Een
 * woord van cijfers raakt een code alleen vanaf het begin ("58" vindt 5800,
 * niet 8358), een lijn of bestemming ook middenin ("58" vindt lijn 858).
 */
export function zoekFilmnummers(items: readonly Filmnummer[], zoek: string): Filmnummer[] {
  const woorden = plat(zoek).split(/\s+/).filter(Boolean);
  if (woorden.length === 0) return [...items];
  return items.filter((f) => {
    const lijn = plat(f.lijn);
    const tekst = plat(f.tekst);
    return woorden.every((w) => f.code.startsWith(w) || lijn.includes(w) || tekst.includes(w));
  });
}

/** "58 filmnummers voor 7 lijnen", voor het logboek en de bevestiging. */
export const filmnummerTelling = (items: readonly Filmnummer[]): string => {
  const lijnen = new Set(items.map((f) => f.lijn).filter(Boolean)).size;
  const nummers = `${items.length} ${items.length === 1 ? 'filmnummer' : 'filmnummers'}`;
  return lijnen === 0 ? nummers : `${nummers} voor ${lijnen} ${lijnen === 1 ? 'lijn' : 'lijnen'}`;
};
