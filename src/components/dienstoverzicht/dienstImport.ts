import type { Service } from '../../types';
import { normalizeTimeString } from '../../lib/shiftTime';

/**
 * Rijen uit het Excel-dienstoverzicht (xlsx `sheet_to_json`, één object per
 * rij met de kolomkoppen als sleutels) naar diensten. Ongewijzigd verhuisd
 * uit Beheer dienstoverzicht (3D.2, 23-09), nu zonder xlsx zodat het los te
 * testen is. Rijen zonder dienstnummer vallen weg.
 */

/** Excel bewaart een tijd als fractie van 24 uur (0,5 = 12:00). */
export const excelTijd = (val: unknown): string => {
  if (val === undefined || val === null || val === '') return '';
  if (typeof val === 'number') {
    const totalSeconds = Math.round(val * 24 * 3600);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }
  return normalizeTimeString(String(val).trim());
};

export function dienstenUitRijen(rijen: Record<string, unknown>[], nu = Date.now()): Service[] {
  return rijen.map((row, index) => {
    const rowKeys = Object.keys(row);
    const findValue = (patterns: string[]) => {
      const foundKey = rowKeys.find((k) => {
        const cleanK = k.toString().trim().toLowerCase();
        return patterns.some((p) => cleanK.includes(p));
      });
      return foundKey ? row[foundKey] : undefined;
    };

    const serviceNumber = findValue(['dienst', 'nummer', 'service', 'nr']);

    // Deel 1
    const startTime = findValue(['start 1', 'begin 1', 'van 1', 'starttijd 1', 'start (deel 1)']);
    const endTime = findValue(['eind 1', 'stop 1', 'tot 1', 'eindtijd 1', 'einde (deel 1)']);

    // Deel 2: herkent ook het xlsx-achtervoegsel wanneer 'begin'/'einde'
    // drie keer voorkomen als kolomnaam (begin_1 = tweede 'begin'-kolom).
    const startTime2 = findValue(['start 2', 'begin 2', 'van 2', 'starttijd 2', 'start (deel 2)', 'begin_1', 'begin2']);
    const endTime2 = findValue(['eind 2', 'stop 2', 'tot 2', 'eindtijd 2', 'einde (deel 2)', 'einde_1', 'einde2']);

    // Deel 3
    const startTime3 = findValue(['start 3', 'begin 3', 'van 3', 'starttijd 3', 'start (deel 3)', 'begin_2', 'begin3']);
    const endTime3 = findValue(['eind 3', 'stop 3', 'tot 3', 'eindtijd 3', 'einde (deel 3)', 'einde_2', 'einde3']);

    // Loopnummers per deel; kolomnaam 'loop 1'/'loopnr 1'/'loopnummer 1'
    // (of zonder cijfer voor deel 1).
    const loopnr = findValue(['loop 1', 'loopnr 1', 'loopnummer 1', 'loop (deel 1)', 'loop', 'loopnr', 'loopnummer']);
    const loopnr2 = findValue(['loop 2', 'loopnr 2', 'loopnummer 2', 'loop (deel 2)', 'loop_1', 'loopnr_1']);
    const loopnr3 = findValue(['loop 3', 'loopnr 3', 'loopnummer 3', 'loop (deel 3)', 'loop_2', 'loopnr_2']);

    // Terugval op een gewone start/eind-kolom als deel 1 geen eigen kolom heeft.
    const finalStart = startTime || findValue(['start', 'begin', 'van']);
    const finalEnd = endTime || findValue(['eind', 'stop', 'tot']);

    const tekst = (v: unknown) => (v == null ? '' : String(v).trim());
    return {
      id: (nu + index).toString(),
      serviceNumber: tekst(serviceNumber),
      startTime: excelTijd(finalStart),
      endTime: excelTijd(finalEnd),
      startTime2: excelTijd(startTime2),
      endTime2: excelTijd(endTime2),
      startTime3: excelTijd(startTime3),
      endTime3: excelTijd(endTime3),
      loopnr: tekst(loopnr),
      loopnr2: tekst(loopnr2),
      loopnr3: tekst(loopnr3),
    };
  }).filter((s) => s.serviceNumber);
}
