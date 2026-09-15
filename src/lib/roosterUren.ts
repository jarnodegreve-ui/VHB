import { addDays, isoDate } from './datum';
import { telDienstdagen } from './dienstTelling';
import { formatGetal, metEenheid } from './format';
import { shiftWindowMinutes } from './shiftTime';

/**
 * Geplande uren op het rooster (punt 15, 15-09): "deze week x u · deze maand
 * y u · z dagen met dienst". Puur afgeleid uit de planning-rijen van de
 * chauffeur, client-side, geen API.
 *
 * Dit zijn GEPLANDE uren (som van de dienstvensters, nachtdienst via
 * shiftWindowMinutes), géén loonberekening: geen pauzeregels, geen
 * looncomponenten, geen premies. Het label bij de strook zegt dat ook.
 *
 * Week = ISO-week (maandag t/m zondag) van de peildag; maand = kalendermaand
 * van de peildag. Een dienst telt bij de dag waarop hij begint, ook als hij
 * over middernacht loopt (busvak-notatie "26:16").
 */
export type RoosterUren = {
  weekMinuten: number;
  maandMinuten: number;
  /** Dagen met minstens één dienst(deel) in de maand van de peildag. */
  maandDienstdagen: number;
};

type Rij = { date: string; startTime: string; endTime: string; driverId?: string };

/** Maandag van de ISO-week waarin `iso` valt. */
export const maandagVan = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00`);
  const dag = (d.getDay() + 6) % 7; // 0 = maandag
  return isoDate(addDays(d, -dag));
};

export const dienstMinuten = (s: { startTime: string; endTime: string }): number => {
  const v = shiftWindowMinutes(s);
  return v ? v.end - v.start : 0;
};

export const berekenRoosterUren = (shifts: readonly Rij[], peildag: string): RoosterUren => {
  const weekStart = maandagVan(peildag);
  const weekEind = isoDate(addDays(new Date(`${weekStart}T00:00:00`), 6));
  const maandPrefix = peildag.slice(0, 7);
  let weekMinuten = 0;
  let maandMinuten = 0;
  const maandRijen: Rij[] = [];
  for (const s of shifts) {
    const min = dienstMinuten(s);
    if (s.date >= weekStart && s.date <= weekEind) weekMinuten += min;
    if (s.date.startsWith(maandPrefix)) {
      maandMinuten += min;
      maandRijen.push(s);
    }
  }
  return { weekMinuten, maandMinuten, maandDienstdagen: telDienstdagen(maandRijen) };
};

/** Minuten per dag (yyyy-mm-dd → minuten), voor de tooltip in het maandgrid. */
export const minutenPerDag = (shifts: readonly Rij[]): Map<string, number> => {
  const map = new Map<string, number>();
  for (const s of shifts) map.set(s.date, (map.get(s.date) ?? 0) + dienstMinuten(s));
  return map;
};

/** 2310 minuten → "38,5 u" (één decimaal, Belgische komma, smalle vaste spatie). */
export const formatUren = (minuten: number): string => metEenheid(formatGetal(minuten / 60, 1), 'u');
