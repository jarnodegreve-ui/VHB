import { describe, expect, it } from 'vitest';
import { berekenMaandoverzicht, dienstMinuten as server } from '../api/helpers';
import { bouwDienstenPerDag } from '../api/_lib/rapporten/planning';
import { dienstMinuten as kerncijfers, dienstStatistiek } from './lib/dienstStatistiek';
import { berekenRoosterUren, dienstMinuten as rooster, minutenPerDag } from './lib/roosterUren';
import { shiftWindowMinutes } from './lib/shiftTime';
import { minutesBetween as maandprint } from './views/PrintMonthlyScheduleView';
import { deelMinuten, deelVenster } from '../shared/busvakTijd';

/**
 * De duur van een dienst wordt op vier plekken gerekend (opruim 28, stap 2).
 * Deze test legt vast wat elke variant geeft, en waar ze uiteenlopen.
 *
 * | variant      | bestand                          | waar je het cijfer ziet                                             |
 * | server       | api/helpers.ts                   | Maandoverzicht van de maandplanning (scherm en Excel), rapporten     |
 * |              |                                  | Overzicht per chauffeur en Diensten per dag (kolom Duur)             |
 * | kerncijfers  | src/lib/dienstStatistiek.ts      | zijvak van het Dienstoverzicht: Langste dienst, Kortste dienst       |
 * | rooster      | src/lib/roosterUren.ts           | Rooster: strook "geplande uren" (staf) en de uren per dag            |
 * | maandprint   | src/views/PrintMonthlyScheduleView | het afgedrukte maandrooster: uren per dag en per maand             |
 *
 * Sinds de beslissing van Jarno (29-09, nummer 28a) rekenen ze alle vier per
 * deel met één regel, `deelVenster` (shared/busvakTijd.ts): een einde vóór de
 * start is over middernacht (22:00 tot 06:00 = 8 uur), busvak-uren gelden
 * zoals ze er staan (08:00 tot 32:00 = 24 uur), en een deel met gelijke
 * begin- en eindtijd (08:00 tot 08:00) is ONGELDIG: het telt 0 minuten, zoals
 * een deel zonder leesbare tijden. Wat nog verschilt is bewust: de
 * kerncijfers keuren strikt (geen seconden), en de server en de kerncijfers
 * geven null waar het rooster en de maandprint 0 optellen.
 */

type Deel = [start: string, eind: string];
const dienst = (delen: Deel[]) => ({
  id: 'x',
  serviceNumber: 'x',
  startTime: delen[0]?.[0] ?? '',
  endTime: delen[0]?.[1] ?? '',
  startTime2: delen[1]?.[0],
  endTime2: delen[1]?.[1],
  startTime3: delen[2]?.[0],
  endTime3: delen[2]?.[1],
});
/** Het rooster en de maandprint krijgen één planning-rij per deel en tellen op. */
const somPerDeel = (f: (start: string, eind: string) => number, delen: Deel[]) => delen.reduce((som, [a, b]) => som + f(a, b), 0);
const meet = (delen: Deel[]) => ({
  server: server(dienst(delen)),
  kerncijfers: kerncijfers(dienst(delen)),
  rooster: somPerDeel((startTime, endTime) => rooster({ startTime, endTime }), delen),
  maandprint: somPerDeel(maandprint, delen),
});

describe('waar de vier varianten hetzelfde geven', () => {
  it('dagdienst 06:00 tot 14:00: 8 uur', () => {
    expect(meet([['06:00', '14:00']])).toEqual({ server: 480, kerncijfers: 480, rooster: 480, maandprint: 480 });
  });

  it('gesplitste dienst 06:00 tot 09:00 en 15:00 tot 18:30: 6 uur 30, de pauze telt niet', () => {
    expect(meet([['06:00', '09:00'], ['15:00', '18:30']])).toEqual({ server: 390, kerncijfers: 390, rooster: 390, maandprint: 390 });
  });

  it('dienst in drie delen', () => {
    expect(meet([['05:00', '07:00'], ['09:00', '11:30'], ['16:00', '19:15']])).toEqual({ server: 465, kerncijfers: 465, rooster: 465, maandprint: 465 });
  });

  it('over middernacht in busvak-notatie, 22:00 tot 26:16: 4 uur 16', () => {
    expect(meet([['22:00', '26:16']])).toEqual({ server: 256, kerncijfers: 256, rooster: 256, maandprint: 256 });
  });

  it('eindigt om middernacht in busvak-notatie, 16:00 tot 24:00: 8 uur', () => {
    expect(meet([['16:00', '24:00']])).toEqual({ server: 480, kerncijfers: 480, rooster: 480, maandprint: 480 });
  });

  it('een uur met één cijfer, 6:00 tot 14:00', () => {
    expect(meet([['6:00', '14:00']])).toEqual({ server: 480, kerncijfers: 480, rooster: 480, maandprint: 480 });
  });
});

describe('de regel van 29-09 (Jarno, 28a): één uitkomst op alle vier de plekken', () => {
  it('over middernacht met gewone uren, 22:00 tot 06:00: 8 uur, ook in de kerncijfers', () => {
    expect(meet([['22:00', '06:00']])).toEqual({ server: 480, kerncijfers: 480, rooster: 480, maandprint: 480 });
  });

  it('eindigt om 00:00, 16:00 tot 00:00: 8 uur, ook in de kerncijfers', () => {
    expect(meet([['16:00', '00:00']])).toEqual({ server: 480, kerncijfers: 480, rooster: 480, maandprint: 480 });
  });

  it('gesplitst met een nachtdeel in gewone uren: beide delen tellen, ook in de kerncijfers', () => {
    expect(meet([['17:00', '20:00'], ['22:00', '02:30']])).toEqual({ server: 450, kerncijfers: 450, rooster: 450, maandprint: 450 });
  });

  it('een etmaal in busvak-uren, 08:00 tot 32:00: 24 uur; 22:00 tot 30:00: 8 uur', () => {
    expect(meet([['08:00', '32:00']])).toEqual({ server: 1440, kerncijfers: 1440, rooster: 1440, maandprint: 1440 });
    expect(meet([['22:00', '30:00']])).toEqual({ server: 480, kerncijfers: 480, rooster: 480, maandprint: 480 });
    // Tegenover het ongeldige deel hieronder: zelfde begin, nu wel een etmaal.
    expect(meet([['08:00', '08:00']])).toEqual({ server: null, kerncijfers: null, rooster: 0, maandprint: 0 });
  });

  it('gelijke begin- en eindtijd, 08:00 tot 08:00: ongeldig, 0 minuten (null op de server en in de kerncijfers)', () => {
    expect(meet([['08:00', '08:00']])).toEqual({ server: null, kerncijfers: null, rooster: 0, maandprint: 0 });
  });

  it('gelijke begin- en eindtijd om middernacht, 00:00 tot 00:00: ongeldig', () => {
    expect(meet([['00:00', '00:00']])).toEqual({ server: null, kerncijfers: null, rooster: 0, maandprint: 0 });
  });

  it('dagdeel plus een deel met gelijke tijden: alleen het dagdeel telt', () => {
    expect(meet([['06:00', '14:00'], ['15:00', '15:00']])).toEqual({ server: 480, kerncijfers: 480, rooster: 480, maandprint: 480 });
  });

  it('een tijd buiten de grenzen, 06:00 tot 48:00: nergens meer een duur (de maandprint rekende 42 uur)', () => {
    expect(meet([['06:00', '48:00']])).toEqual({ server: null, kerncijfers: null, rooster: 0, maandprint: 0 });
  });
});

describe('waar ze nog uiteenlopen (bewust)', () => {
  it('tijden met seconden, 06:00:00 tot 14:00:00: de kerncijfers keuren strikt en lezen ze niet', () => {
    expect(meet([['06:00:00', '14:00:00']])).toEqual({ server: 480, kerncijfers: null, rooster: 480, maandprint: 480 });
  });

  it('geen leesbare tijden: null op de server en bij de kerncijfers, 0 op het rooster en de maandprint', () => {
    expect(meet([['', '']])).toEqual({ server: null, kerncijfers: null, rooster: 0, maandprint: 0 });
    expect(meet([['x', '08:00']])).toEqual({ server: null, kerncijfers: null, rooster: 0, maandprint: 0 });
  });
});

describe('deelVenster en deelMinuten: de gedeelde rekenregel', () => {
  const GEVALLEN: Array<[string | null | undefined, string | null | undefined, number | null]> = [
    ['06:00', '14:00', 480],
    ['6:00', '14:00', 480],
    ['22:00', '26:16', 256],
    ['22:00', '06:00', 480],
    ['22:00', '30:00', 480],
    ['08:00', '32:00', 1440],
    ['16:00', '24:00', 480],
    ['16:00', '00:00', 480],
    ['24:30', '06:00', 330],
    ['06:00:00', '14:00:00', 480],
    [' 06:00 ', '14:00', 480],
    // Gelijke begin- en eindtijd: ongeldig (was een etmaal, 1440).
    ['08:00', '08:00', null],
    ['00:00', '00:00', null],
    ['8:00', '08:00', null],
    ['24:30', '24:30', null],
    ['', '', null],
    ['06:00', '', null],
    ['x', '08:00', null],
    ['06:00', '48:00', null],
    ['06:00', '07:60', null],
    [null, undefined, null],
  ];

  it('deelMinuten en de server geven per deel de duur; gelijke tijden geven null', () => {
    for (const [a, b, verwacht] of GEVALLEN) {
      expect(deelMinuten(a, b), `${a} tot ${b}`).toBe(verwacht);
      expect(server({ startTime: a, endTime: b }), `server ${a} tot ${b}`).toBe(verwacht);
    }
  });

  it('deelVenster en shiftWindowMinutes (Mijn dag, dashboard, rooster) geven hetzelfde venster; gelijke tijden geen venster', () => {
    for (const [a, b, verwacht] of GEVALLEN) {
      const rij = { startTime: a as string, endTime: b as string };
      const venster = deelVenster(a, b);
      expect(venster ? venster.end - venster.start : null, `deelVenster ${a} tot ${b}`).toBe(verwacht);
      expect(shiftWindowMinutes(rij), `venster ${a} tot ${b}`).toEqual(venster);
    }
    expect(deelVenster('22:00', '06:00')).toEqual({ start: 1320, end: 1800 });
    expect(deelVenster('16:00', '00:00')).toEqual({ start: 960, end: 1440 });
    expect(deelVenster('08:00', '32:00')).toEqual({ start: 480, end: 1920 });
    expect(deelVenster('08:00', '08:00')).toBeNull();
  });

  it('het rooster en de maandprint geven per deel dezelfde duur, 0 waar er geen is', () => {
    for (const [a, b, verwacht] of GEVALLEN) {
      expect(rooster({ startTime: a as string, endTime: b as string }), `rooster ${a} tot ${b}`).toBe(verwacht ?? 0);
      if (typeof a === 'string' && typeof b === 'string') expect(maandprint(a, b), `maandprint ${a} tot ${b}`).toBe(verwacht ?? 0);
    }
  });

  it('de server telt de delen op en slaat een onleesbaar of ongeldig deel over', () => {
    expect(server({ startTime: '06:00', endTime: '09:00', startTime2: '--', endTime2: '--', startTime3: '15:00', endTime3: '18:30' })).toBe(390);
    expect(server({ startTime: '06:00', endTime: '09:00', startTime2: '12:00', endTime2: '12:00', startTime3: '15:00', endTime3: '18:30' })).toBe(390);
    expect(server({ startTime: null, endTime: null })).toBeNull();
    expect(server({})).toBeNull();
  });
});

/**
 * De aanroepers (stap 2 van nummer 28): wie `?? 0` doet telt 0 minuten, maar
 * een dienst met een ongeldig deel telt nog als dienst en als dag, en blijft
 * zichtbaar.
 */
describe('de aanroepers: een ongeldig deel telt 0 minuten, de dienst telt nog mee', () => {
  const DAGEN = ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'];
  const DIENSTEN = [
    { serviceNumber: 'N1', startTime: '22:00', endTime: '06:00' },
    { serviceNumber: 'L1', startTime: '08:00', endTime: '08:00' },
    { serviceNumber: 'E1', startTime: '08:00', endTime: '32:00' },
    { serviceNumber: 'A1', startTime: '16:00', endTime: '00:00' },
  ];

  it('Maandoverzicht (berekenMaandoverzicht): 4 diensten op 4 dagen, 40 uur (22:00-06:00 8, 08:00-08:00 0, 08:00-32:00 24, 16:00-00:00 8)', () => {
    const cells = { c1: Object.fromEntries(DAGEN.map((iso, i) => [iso, { code: DIENSTEN[i].serviceNumber, kind: 'service' }])) };
    const { rijen, totaal } = berekenMaandoverzicht(DAGEN, [{ id: 'c1', name: 'Chauffeur' }], cells, DIENSTEN, []);
    expect(rijen[0]).toMatchObject({ diensten: 4, dagen: 4, minuten: 480 + 0 + 1440 + 480 });
    expect(totaal.minuten).toBe(2400);
    // Alleen het ongeldige deel: telt als dienst en als dag, met 0 minuten.
    const alleen = berekenMaandoverzicht(['2026-09-29'], [{ id: 'c1', name: 'Chauffeur' }], { c1: { '2026-09-29': { code: 'L1', kind: 'service' } } }, DIENSTEN, []);
    expect(alleen.rijen[0]).toMatchObject({ diensten: 1, dagen: 1, minuten: 0 });
  });

  it('rapport Diensten per dag (bouwDienstenPerDag): elk deel een rij, Duur leeg bij het ongeldige deel', () => {
    const planning = DIENSTEN.map((d, i) => ({ id: `p${i}`, date: '2026-09-29', startTime: d.startTime, endTime: d.endTime, line: d.serviceNumber, driverId: '1' }));
    const uit = bouwDienstenPerDag({ planning, users: [] }, { van: '2026-09-29', tot: '2026-09-29', keuzes: {} } as never);
    expect(Object.fromEntries(uit.rijen.map((r) => [r.dienst, r.duur]))).toEqual({ N1: 480, L1: null, E1: 1440, A1: 480 });
  });

  it('rooster (berekenRoosterUren, minutenPerDag): 0 minuten voor het ongeldige deel, de dag telt als dienstdag', () => {
    const rijen = DIENSTEN.map((d, i) => ({ date: DAGEN[i], startTime: d.startTime, endTime: d.endTime }));
    expect(berekenRoosterUren(rijen, '2026-09-29')).toEqual({ weekMinuten: 2400, maandMinuten: 480 + 0 + 1440, maandDienstdagen: 3 });
    expect(Object.fromEntries(minutenPerDag(rijen))).toEqual({ '2026-09-28': 480, '2026-09-29': 0, '2026-09-30': 1440, '2026-10-01': 480 });
  });

  it('maandprint (minutesBetween): 8, 0, 24 en 8 uur', () => {
    expect(DIENSTEN.map((d) => maandprint(d.startTime, d.endTime))).toEqual([480, 0, 1440, 480]);
  });

  it('kerncijfers (dienstStatistiek): 22:00-06:00 telt als 8 uur, een dienst met alleen een ongeldig deel telt niet mee', () => {
    const s = dienstStatistiek(DIENSTEN.map((d, i) => ({ id: String(i), ...d })));
    expect(s.diensten).toBe(4);
    expect(s.langste).toEqual({ serviceNumber: 'E1', minuten: 1440 });
    expect(s.kortste).toEqual({ serviceNumber: 'N1', minuten: 480 });
  });
});
