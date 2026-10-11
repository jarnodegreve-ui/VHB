import { isDagtypeCode, type DienstTijden, type DienstVariant, DIENST_TIJD_VELDEN } from '../../../shared/dagtype';
import { isValidBusvakTime, normalizeTimeString } from '../../lib/shiftTime';

/**
 * Afwijkende tijden per dagtype in het formulier van het Dienstoverzicht
 * (deel 2, 10-10): de formuliervorm van een variant, het voorvullen met de
 * gewone tijden en de controle vóór het opslaan. Zuiver, zonder React, zodat
 * het los te testen is; de opslagvorm zelf staat in shared/dagtype.ts.
 */

/** Eén afwijking zoals ze in het formulier staat: alle velden als tekst. */
export type VariantFormulier = {
  /** Vaste sleutel voor React en voor de veldfouten; niet opgeslagen. */
  sleutel: string;
  dagtypes: string[];
  startTime: string; endTime: string; loopnr: string;
  startTime2: string; endTime2: string; loopnr2: string;
  startTime3: string; endTime3: string; loopnr3: string;
};

const TIJD_VELDEN = ['startTime', 'endTime', 'startTime2', 'endTime2', 'startTime3', 'endTime3'] as const;
const DELEN = [['startTime', 'endTime'], ['startTime2', 'endTime2'], ['startTime3', 'endTime3']] as const;

/** Zelfde zin als het hoofdformulier; "0630" mag sinds 10-10 (iPhone-cijferklavier). */
export const TIJD_TITEL = 'UU:MM of UUMM, na middernacht als 24:00+ (bv. 26:16)';
export const tijdFout = (raw: string): string => `Ongeldige tijd “${raw}”, gebruik UU:MM of UUMM, na middernacht als 24:00+ (bv. 26:16).`;

let teller = 0;
/** Verse sleutel per variant (uniek binnen de sessie). */
export const verseSleutel = (): string => `v${Date.now().toString(36)}-${(teller += 1)}`;

const tekst = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** Formuliervorm van opgeslagen varianten. */
export const variantenNaarFormulier = (varianten: readonly DienstVariant[] | null | undefined): VariantFormulier[] =>
  (varianten ?? []).map((v) => ({
    sleutel: verseSleutel(),
    dagtypes: [...v.dagtypes],
    startTime: tekst(v.startTime), endTime: tekst(v.endTime), loopnr: tekst(v.loopnr),
    startTime2: tekst(v.startTime2), endTime2: tekst(v.endTime2), loopnr2: tekst(v.loopnr2),
    startTime3: tekst(v.startTime3), endTime3: tekst(v.endTime3), loopnr3: tekst(v.loopnr3),
  }));

/** Een nieuwe afwijking, vooraf gevuld met de gewone tijden van het formulier
 *  (de planner past dan alleen aan wat anders is) en zonder dagtypes. */
export const nieuweVariant = (basis: DienstTijden): VariantFormulier => ({
  sleutel: verseSleutel(),
  dagtypes: [],
  startTime: tekst(basis.startTime), endTime: tekst(basis.endTime), loopnr: tekst(basis.loopnr),
  startTime2: tekst(basis.startTime2), endTime2: tekst(basis.endTime2), loopnr2: tekst(basis.loopnr2),
  startTime3: tekst(basis.startTime3), endTime3: tekst(basis.endTime3), loopnr3: tekst(basis.loopnr3),
});

/** Sleutel van een veldfout: `variant-<sleutel>-<veld>`, `-dagtypes` voor de keuzelijst. */
export const variantVeld = (sleutel: string, veld: string): string => `variant-${sleutel}-${veld}`;

/** Welke afwijking (index) een dagtype al gebruikt, per code; voor de keuzelijst. */
export const dagtypeInGebruik = (varianten: readonly VariantFormulier[]): Map<string, number> => {
  const m = new Map<string, number>();
  varianten.forEach((v, i) => { for (const c of v.dagtypes) if (!m.has(c)) m.set(c, i); });
  return m;
};

export type VariantenControle =
  | { ok: true; varianten: DienstVariant[] | undefined }
  | { ok: false; fouten: Record<string, string> };

/**
 * Controle vóór het opslaan, met dezelfde tijdregels als de gewone velden
 * (busvak, "6:00" → "06:00"). Elke fout hangt aan het veld waar ze over
 * gaat. Geen varianten = ok met undefined.
 */
export function valideerVarianten(varianten: readonly VariantFormulier[]): VariantenControle {
  const fouten: Record<string, string> = {};
  const uit: DienstVariant[] = [];
  const gezien = new Map<string, number>();
  varianten.forEach((v, i) => {
    const veld = (naam: string) => variantVeld(v.sleutel, naam);
    const codes = v.dagtypes.filter(isDagtypeCode);
    if (codes.length === 0) fouten[veld('dagtypes')] = 'Kies minstens één dagtype waarop deze tijden gelden.';
    for (const c of codes) {
      const eerder = gezien.get(c);
      if (eerder !== undefined && eerder !== i) fouten[veld('dagtypes')] = `Een dagtype kan maar in één afwijking staan; kijk afwijking ${eerder + 1} na.`;
      else gezien.set(c, i);
    }
    const tijden: DienstTijden = {};
    for (const t of TIJD_VELDEN) {
      const raw = v[t].trim();
      if (!raw) continue;
      // Eerst normaliseren ("0630" → "06:30"), dan pas toetsen.
      const tijd = normalizeTimeString(raw);
      if (!isValidBusvakTime(tijd)) { fouten[veld(t)] = tijdFout(raw); continue; }
      tijden[t] = tijd;
    }
    // Deel 1 is verplicht, zoals bij een gewone dienst; deel 2 en 3 zijn
    // compleet of leeg.
    for (const [start, einde] of DELEN) {
      const s = tijden[start]; const e = tijden[einde];
      const verplicht = start === 'startTime';
      if ((s || verplicht) && !e && !fouten[veld(einde)] && !v[einde].trim()) fouten[veld(einde)] = verplicht ? 'Vul de eindtijd van deel 1 in.' : 'Vul ook de eindtijd in.';
      if ((e || verplicht) && !s && !fouten[veld(start)] && !v[start].trim()) fouten[veld(start)] = verplicht ? 'Vul de starttijd van deel 1 in.' : 'Vul ook de starttijd in.';
    }
    for (const l of ['loopnr', 'loopnr2', 'loopnr3'] as const) {
      const w = v[l].trim();
      if (w) tijden[l] = w;
    }
    uit.push({ dagtypes: codes, ...tijden });
  });
  if (Object.keys(fouten).length > 0) return { ok: false, fouten };
  return { ok: true, varianten: uit.length > 0 ? uit : undefined };
}

/** Alleen de tijd- en loopvelden van het dienstformulier, voor het voorvullen. */
export const tijdenUitFormulier = (f: Record<string, unknown>): DienstTijden =>
  Object.fromEntries(DIENST_TIJD_VELDEN.map((veld) => [veld, tekst(f[veld])])) as DienstTijden;
