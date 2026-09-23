// Eigen module (niet in kalender.ts): kalender.ts zit via de datumkiezer in
// de warmup, het maandveld wordt op één beheerscherm gebruikt.

// === Typbare maand: mm/jjjj ↔ 'YYYY-MM' (datumtranche PR 4, 23-09) ===

/** Wat de gebruiker in een maandveld typte, zonder browserparsing. */
export type MaandInvoer =
  | { staat: 'leeg' }
  | { staat: 'geldig'; maand: string }
  | { staat: 'fout'; reden: string };

const MJ_MET_SCHEIDING = /^(\d{1,2})[/.-](\d{4})$/;
const MJ_ZES_CIJFERS = /^(\d{2})(\d{4})$/;
export const MJ_VORM = 'Gebruik mm/jjjj, bijvoorbeeld 09/2026.';

/**
 * `09/2026`, ook met `-` of `.`, een maand van één cijfer (`9/2026`) of zes
 * cijfers zonder scheiding (`092026`, iPhone-cijferklavier). Altijd maand
 * dan jaar, jaar van vier cijfers; niets wordt geraden.
 */
export function leesMj(tekst: string): MaandInvoer {
  const t = tekst.trim();
  if (!t) return { staat: 'leeg' };
  const m = MJ_MET_SCHEIDING.exec(t) ?? MJ_ZES_CIJFERS.exec(t);
  if (!m) return { staat: 'fout', reden: MJ_VORM };
  const maand = Number(m[1]);
  const jaar = Number(m[2]);
  if (jaar < 1900 || jaar > 2100) return { staat: 'fout', reden: 'Controleer het jaar.' };
  if (maand < 1 || maand > 12) return { staat: 'fout', reden: 'Die maand bestaat niet.' };
  return { staat: 'geldig', maand: `${m[2]}-${String(maand).padStart(2, '0')}` };
}

const MAAND_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Geldige maand 'YYYY-MM'? */
export const isMaand = (s: string | null | undefined): s is string => !!s && MAAND_RE.test(s);
/** 'YYYY-MM' → 'mm/jjjj'; '' als het geen geldige maand is. */
export const maandNaarMj = (maand: string | null | undefined): string => (isMaand(maand) ? `${maand.slice(5, 7)}/${maand.slice(0, 4)}` : '');
/** Fouttekst als een maand buiten [min, max] valt, anders null. */
export const maandBereikFout = (maand: string, min?: string, max?: string): string | null =>
  min && maand < min ? `Vroegst ${maandNaarMj(min)}.` : max && maand > max ? `Uiterlijk ${maandNaarMj(max)}.` : null;
