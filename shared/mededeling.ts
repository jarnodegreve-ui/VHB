/**
 * Mededeling voor de chauffeurs (08-10, vraag Jarno): één korte tekst die de
 * beheerder aanzet als geheugensteuntje, bv. "Opgelet, vanaf 11/12 nieuwe
 * dienstregeling!". Ze staat als rustige strook op Ritbladen, Mijn dag en
 * het dashboard. Eén app_settings-sleutel, geen migratie.
 *
 * Zod-vrij: Mijn dag en het dashboard zijn startschermen zonder zod; het
 * schema van de PUT-body staat in shared/schemas/mededeling.ts.
 */
export const MEDEDELING_SETTING_KEY = 'ritblad_mededeling';
export const MEDEDELING_TEKST_MAX = 160;

export type Mededeling = {
  tekst: string;
  tonen: boolean;
  /** Laatste dag (JJJJ-MM-DD) waarop de mededeling nog getoond wordt; leeg = tot ze uitgezet wordt. */
  tot: string | null;
};

export const GEEN_MEDEDELING: Mededeling = { tekst: '', tonen: false, tot: null };

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/;

/** Onbekende invoer (jsonb uit de database, API-antwoord) → geldige mededeling, anders geen. */
export function parseMededeling(waarde: unknown): Mededeling {
  if (!waarde || typeof waarde !== 'object') return GEEN_MEDEDELING;
  const w = waarde as Record<string, unknown>;
  const tekst = typeof w.tekst === 'string' ? w.tekst.trim().slice(0, MEDEDELING_TEKST_MAX) : '';
  const tot = typeof w.tot === 'string' && ISO_DAG.test(w.tot) ? w.tot : null;
  return { tekst, tonen: w.tonen === true, tot };
}

/** Staat ze aan, is er tekst, en is de einddag nog niet voorbij? */
export const mededelingZichtbaar = (m: Mededeling, vandaag: string): boolean =>
  m.tonen && m.tekst.trim().length > 0 && (m.tot === null || m.tot >= vandaag);
