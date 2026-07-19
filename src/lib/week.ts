/**
 * ISO-weeknummer (Europees: maandag = dag 1, week 1 bevat 4 januari).
 * Eén gedeelde implementatie — de print-, maandplanning- en roosterweergave
 * gebruiken deze zodat de weeknummers overal exact gelijk lopen.
 */
export const isoWeekNumber = (d: Date): number => {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
};

/** Weeknummer uit een 'YYYY-MM-DD'-string. */
export const isoWeekOf = (iso: string): number => isoWeekNumber(new Date(`${iso}T00:00:00`));

/** Label voor een reeks datums: 'wk 29' of 'wk 29–30' bij een spanning. */
export const weekRangeLabel = (isoDates: string[]): string => {
  if (isoDates.length === 0) return '';
  // In DÁTUM-volgorde nemen, niet op weeknummer sorteren: rond de jaargrens is
  // week 53 → week 1 chronologisch, numeriek zou dat 'wk 1–53' maken.
  const sorted = [...isoDates].sort();
  const first = isoWeekOf(sorted[0]);
  const last = isoWeekOf(sorted[sorted.length - 1]);
  return first === last ? `wk ${first}` : `wk ${first}–${last}`;
};
