/**
 * Kalenderrekenen op ISO-datumstrings, zonder tijdzones: alles in het UTC-
 * frame, zodat een dag nooit verschuift door zomertijd of de lokale klok.
 * Eén bron aan de clientkant — stond als addDagen/maandPlus verspreid over
 * schoolkalender, vervangers en het laadpalen-dashboard (controle-ronde
 * 27-08, bevindingen 41 en 43). De API-kant heeft zijn eigen exemplaar in
 * api/helpers.ts (addDagenIso): api/ en src/ delen bewust geen code.
 */

/** "YYYY-MM-DD" ± n dagen. */
export const addDagen = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** "YYYY-MM" ± n maanden, over jaargrenzen heen. */
export const maandPlus = (maand: string, delta: number): string => {
  const [j, m] = maand.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
