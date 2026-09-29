/**
 * Een dienst-deel met twee leesbare tijden maar zonder venster (beslissing
 * Jarno 29-09, nummer 28b): gelijke begin- en eindtijd (08:00 tot 08:00), of
 * een einde dat ook na +24 u niet na de start ligt (24:30 tot 00:00, 30:00
 * tot 06:00). In elke berekening is zo'n deel ongeldig (`deelVenster` in
 * shared/busvakTijd.ts geeft null); aan de ingang wordt het geweigerd, met een
 * melding die dienst en deel noemt:
 *
 * - het formulier van het Dienstoverzicht: een veldfout bij de eindtijd;
 * - de Excel-import: in de bevestiging, de tijden en het loopnummer van dat
 *   deel gaan niet mee (src/components/dienstoverzicht/dienstImport.ts);
 * - de server: een 400 op POST /api/services.
 *
 * Een eigen module, niet in shared/busvakTijd.ts: die zit in de chunk van de
 * startschermen, en dit hoort alleen bij het Dienstoverzicht en de server.
 */
import { deelVenster, parseHHMM, parseHHMMStrikt } from './busvakTijd.js';

export type DienstTijden = {
  serviceNumber?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  startTime2?: unknown;
  endTime2?: unknown;
  startTime3?: unknown;
  endTime3?: unknown;
};

/** De drie delen van een dienst en hun velden. */
export const DIENST_DELEN = [
  { deel: 1, start: 'startTime', einde: 'endTime', loop: 'loopnr' },
  { deel: 2, start: 'startTime2', einde: 'endTime2', loop: 'loopnr2' },
  { deel: 3, start: 'startTime3', einde: 'endTime3', loop: 'loopnr3' },
] as const;

export type OngeldigDeel = (typeof DIENST_DELEN)[number] & {
  dienst: string;
  /** 'gelijk': dezelfde begin- en eindtijd; 'geenVenster': het einde ligt ook na +24 u niet na de start. */
  soort: 'gelijk' | 'geenVenster';
  /** "08:00" (gelijk) of "24:30 tot 00:00". */
  tijden: string;
  melding: string;
};

const klok = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** "Deel 2 van dienst 2115 heeft dezelfde begin- en eindtijd (08:00). Een
 *  dienst van een etmaal schrijf je in busvak-uren, bv. 08:00 tot 32:00."
 *  Het voorbeeld rekent vanaf de eigen begintijd, zolang die plus 24 uur nog
 *  een busvak-tijd is (tot 47:59). */
export const gelijkeTijdenMelding = (dienst: string, deel: number, minuten: number): string => {
  const etmaal = minuten + 1440 <= 47 * 60 + 59 ? `${klok(minuten)} tot ${klok(minuten + 1440)}` : '08:00 tot 32:00';
  return `Deel ${deel} van dienst ${dienst} heeft dezelfde begin- en eindtijd (${klok(minuten)}). Een dienst van een etmaal schrijf je in busvak-uren, bv. ${etmaal}.`;
};

/** Een einde dat ook na +24 u niet na de start ligt. Dat kan alleen met een
 *  start in busvak-uren (24:00 of later) en een einde in gewone uren. */
export const geenVensterMelding = (dienst: string, deel: number, begin: number, einde: number): string =>
  `Deel ${deel} van dienst ${dienst} eindigt niet na de start (${klok(begin)} tot ${klok(einde)}). Begint een deel na middernacht, schrijf dan ook het einde in busvak-uren: 02:15 wordt 26:15.`;

/** Elk deel met twee leesbare tijden zonder venster, in de volgorde van de
 *  diensten en hun delen. Wat geen object is (een kapotte back-up) wordt
 *  overgeslagen; een deel zonder twee leesbare tijden hoort hier niet bij. */
export const ongeldigeDelen = (diensten: readonly DienstTijden[]): OngeldigDeel[] => {
  const uit: OngeldigDeel[] = [];
  for (const d of diensten) {
    if (!d || typeof d !== 'object') continue;
    for (const veld of DIENST_DELEN) {
      const begin = parseHHMM(d[veld.start]);
      const einde = parseHHMM(d[veld.einde]);
      if (begin === null || einde === null || deelVenster(d[veld.start], d[veld.einde]) !== null) continue;
      const dienst = String(d.serviceNumber ?? '').trim() || '(zonder nummer)';
      const gelijk = begin === einde;
      uit.push({
        ...veld,
        dienst,
        soort: gelijk ? 'gelijk' : 'geenVenster',
        tijden: gelijk ? klok(begin) : `${klok(begin)} tot ${klok(einde)}`,
        melding: gelijk ? gelijkeTijdenMelding(dienst, veld.deel, begin) : geenVensterMelding(dienst, veld.deel, begin, einde),
      });
    }
  }
  return uit;
};

/** Heeft de dienst minstens één deel dat een planning-rij wordt: twee strikt
 *  geschreven tijden (zoals getServiceSegments in api/storage.ts) met een
 *  venster. */
export const heeftGeldigDeel = (d: DienstTijden): boolean =>
  DIENST_DELEN.some((veld) =>
    parseHHMMStrikt(d[veld.start]) !== null && parseHHMMStrikt(d[veld.einde]) !== null && deelVenster(d[veld.start], d[veld.einde]) !== null);
