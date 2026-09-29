import type { Service } from '../../types';
import { normalizeTimeString } from '../../lib/shiftTime';
import { DIENST_DELEN, heeftGeldigDeel, ongeldigeDelen, type OngeldigDeel } from '../../../shared/gelijkeTijden';

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

/** Eén Excel-rij, nog niet omgezet: het dienstnummer en per deel de ruwe cellen. */
type RuweRij = { dienstnummer: unknown; delen: Array<{ start: unknown; eind: unknown; loop: unknown }> };

const leesRij = (row: Record<string, unknown>): RuweRij => {
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

  return {
    dienstnummer: serviceNumber,
    delen: [
      { start: finalStart, eind: finalEnd, loop: loopnr },
      { start: startTime2, eind: endTime2, loop: loopnr2 },
      { start: startTime3, eind: endTime3, loop: loopnr3 },
    ],
  };
};

const tekst = (v: unknown) => (v == null ? '' : String(v).trim());

const naarDienst = (r: RuweRij, id: string): Service => ({
  id,
  serviceNumber: tekst(r.dienstnummer),
  startTime: excelTijd(r.delen[0].start),
  endTime: excelTijd(r.delen[0].eind),
  startTime2: excelTijd(r.delen[1].start),
  endTime2: excelTijd(r.delen[1].eind),
  startTime3: excelTijd(r.delen[2].start),
  endTime3: excelTijd(r.delen[2].eind),
  loopnr: tekst(r.delen[0].loop),
  loopnr2: tekst(r.delen[1].loop),
  loopnr3: tekst(r.delen[2].loop),
});

export function dienstenUitRijen(rijen: Record<string, unknown>[], nu = Date.now()): Service[] {
  return rijen.map((row, index) => naarDienst(leesRij(row), (nu + index).toString())).filter((s) => s.serviceNumber);
}

export type DienstImport = {
  diensten: Service[];
  /** Delen met 0 als begin én einde in Excel (een lege kolom): als leeg ingelezen. */
  legeDelen: number;
  /** Delen met twee leesbare tijden zonder venster: zonder tijden en loopnummer ingelezen. */
  ongeldig: OngeldigDeel[];
  /** Diensten die daardoor geen enkel geldig deel meer hebben, dus geen planning-rijen krijgen. */
  zonderGeldigDeel: string[];
};

const isNul = (v: unknown) => typeof v === 'number' && v === 0;

/**
 * De Excel-import van het Dienstoverzicht (Jarno 29-09, nummer 28b). De
 * server weigert een deel met twee leesbare tijden zonder venster (gelijke
 * begin- en eindtijd, of een einde dat ook na +24 u niet na de start ligt)
 * met een 400; de import maakt zo'n deel daarom leeg, nooit stil:
 *
 * - 0 als begin én einde (een getal, dus een lege kolom in Excel, die
 *   excelTijd anders "00:00 tot 00:00" maakt) is gewoon een leeg deel: geen
 *   tijden, geen loopnummer, één samenvattende regel in de bevestiging;
 * - elk ander deel zonder venster gaat zonder tijden en zonder loopnummer mee
 *   (anders telde het loopnummer mee in de kerncijfers), en de bevestiging
 *   noemt dienst en deel;
 * - een dienst die daardoor geen enkel geldig deel meer heeft, krijgt geen
 *   planning-rijen: de bevestiging zegt dat apart.
 */
export function leesDienstenImport(rijen: Record<string, unknown>[], nu = Date.now()): DienstImport {
  const uit: DienstImport = { diensten: [], legeDelen: 0, ongeldig: [], zonderGeldigDeel: [] };
  rijen.forEach((row, index) => {
    const ruw = leesRij(row);
    const dienst = naarDienst(ruw, (nu + index).toString());
    if (!dienst.serviceNumber) return;
    let geleegd = false;
    DIENST_DELEN.forEach((veld, i) => {
      if (!isNul(ruw.delen[i].start) || !isNul(ruw.delen[i].eind)) return;
      dienst[veld.start] = '';
      dienst[veld.einde] = '';
      dienst[veld.loop] = '';
      uit.legeDelen += 1;
      geleegd = true;
    });
    for (const deel of ongeldigeDelen([dienst])) {
      dienst[deel.start] = '';
      dienst[deel.einde] = '';
      dienst[deel.loop] = '';
      uit.ongeldig.push(deel);
      geleegd = true;
    }
    if (geleegd && !heeftGeldigDeel(dienst)) uit.zonderGeldigDeel.push(dienst.serviceNumber);
    uit.diensten.push(dienst);
  });
  return uit;
}
