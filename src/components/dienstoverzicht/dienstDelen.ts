import type { Service } from '../../types';

/**
 * Zuivere hulpjes van het Dienstoverzicht (3D.1, 23-09): één plek voor wat
 * de leesweergave en Beheer dienstoverzicht elk apart schreven.
 */

/** Een deel telt alleen met een geldige begin- én eindtijd (H:MM of HH:MM,
 *  busvak tot 47:59). Zo toont een dienst van één of twee delen geen lege
 *  deel-kolommen met een streepje. */
export const hasValidTime = (start?: string, end?: string) =>
  !!start && !!end && /^\d{1,2}:\d{2}$/.test(start) && /^\d{1,2}:\d{2}$/.test(end);

/** "04:36–07:52": en-dash zonder spaties. */
export const tijdvak = (van: string, tot: string) => `${van}–${tot}`;

export type DienstDeel = { nr: 1 | 2 | 3; loop: string; start: string; eind: string };

/** De delen van een dienst die getoond worden. Deel 1 staat er altijd (ook
 *  zoals vroeger zonder tijden), deel 2 en 3 alleen met geldige tijden. */
export function delenVan(s: Service): DienstDeel[] {
  const delen: DienstDeel[] = [{ nr: 1, loop: s.loopnr?.trim() ?? '', start: s.startTime ?? '', eind: s.endTime ?? '' }];
  if (hasValidTime(s.startTime2, s.endTime2)) delen.push({ nr: 2, loop: s.loopnr2?.trim() ?? '', start: s.startTime2!, eind: s.endTime2! });
  if (hasValidTime(s.startTime3, s.endTime3)) delen.push({ nr: 3, loop: s.loopnr3?.trim() ?? '', start: s.startTime3!, eind: s.endTime3! });
  return delen;
}

/** Zoekt op dienstnummer én op de drie loopnummers: "welke dienst bevat loop
 *  4515?" is een dagelijkse vraag. Hoofdletters tellen niet. */
export function zoekDiensten(services: Service[], zoek: string): Service[] {
  const term = zoek.trim().toLowerCase();
  if (!term) return services;
  return services.filter((s) =>
    [s.serviceNumber, s.loopnr, s.loopnr2, s.loopnr3].some((v) => (v ?? '').toLowerCase().includes(term)));
}

/** Sorteersleutels van de kolomkoppen; `volgorde` = de volgorde van de lijst
 *  zelf (zoals geïmporteerd of opgeslagen), zonder zichtbare kolom. */
export type DienstSortering = 'volgorde' | 'dienst' | 'loop1' | 'start';

export function dienstSorteerWaarde(s: Service, k: DienstSortering, volgorde: Map<string, number>): string | number | null {
  switch (k) {
    case 'volgorde': return volgorde.get(s.id) ?? 0;
    case 'dienst': return s.serviceNumber;
    case 'loop1': return s.loopnr || null;
    case 'start': return s.startTime || null;
  }
}
