/**
 * Een dienst-deel met gelijke begin- en eindtijd (beslissing Jarno 29-09,
 * nummer 28b). In elke berekening is zo'n deel ongeldig (`deelVenster` in
 * shared/busvakTijd.ts geeft null); aan de ingang wordt het geweigerd, met één
 * melding die dienst en deel noemt:
 *
 * - het formulier van het Dienstoverzicht: een veldfout bij de eindtijd;
 * - de Excel-import: een waarschuwing in de bevestiging, de tijden van dat
 *   deel gaan niet mee (een 0 in een ongebruikte kolom wordt "00:00", zie
 *   excelTijd in src/components/dienstoverzicht/dienstImport.ts);
 * - de server: een 400 op POST /api/services.
 *
 * Een eigen module, niet in shared/busvakTijd.ts: die zit in de chunk van de
 * startschermen, en dit hoort alleen bij het Dienstoverzicht en de server.
 */
import { parseHHMM } from './busvakTijd.js';

export type DienstTijden = {
  serviceNumber?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  startTime2?: unknown;
  endTime2?: unknown;
  startTime3?: unknown;
  endTime3?: unknown;
};

const DELEN = [
  { deel: 1, start: 'startTime', einde: 'endTime' },
  { deel: 2, start: 'startTime2', einde: 'endTime2' },
  { deel: 3, start: 'startTime3', einde: 'endTime3' },
] as const;

export type DeelMetGelijkeTijden = (typeof DELEN)[number] & { dienst: string; melding: string };

const klok = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "Deel 2 van dienst 2115 heeft dezelfde begin- en eindtijd (08:00). Een
 *  dienst van een etmaal schrijf je in busvak-uren, bv. 08:00 tot 32:00."
 *  Het voorbeeld rekent vanaf de eigen begintijd, zolang die plus 24 uur nog
 *  een busvak-tijd is (tot 47:59). */
export const gelijkeTijdenMelding = (dienst: string, deel: number, minuten: number): string => {
  const etmaal = minuten + 1440 <= 47 * 60 + 59 ? `${klok(minuten)} tot ${klok(minuten + 1440)}` : '08:00 tot 32:00';
  return `Deel ${deel} van dienst ${dienst} heeft dezelfde begin- en eindtijd (${klok(minuten)}). Een dienst van een etmaal schrijf je in busvak-uren, bv. ${etmaal}.`;
};

/** Elk deel met twee leesbare, gelijke tijden ("08:00" en "8:00" tellen als
 *  gelijk), in de volgorde van de diensten en hun delen. Wat geen object is
 *  (een kapotte back-up) wordt overgeslagen. */
export const delenMetGelijkeTijden = (diensten: readonly DienstTijden[]): DeelMetGelijkeTijden[] => {
  const uit: DeelMetGelijkeTijden[] = [];
  for (const d of diensten) {
    if (!d || typeof d !== 'object') continue;
    for (const veld of DELEN) {
      const begin = parseHHMM(d[veld.start]);
      if (begin === null || begin !== parseHHMM(d[veld.einde])) continue;
      const dienst = String(d.serviceNumber ?? '').trim() || '(zonder nummer)';
      uit.push({ ...veld, dienst, melding: gelijkeTijdenMelding(dienst, veld.deel, begin) });
    }
  }
  return uit;
};
