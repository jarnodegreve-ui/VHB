import { describe, expect, it } from 'vitest';
import { dienstMinuten as server } from '../api/helpers';
import { dienstMinuten as kerncijfers } from './lib/dienstStatistiek';
import { dienstMinuten as rooster } from './lib/roosterUren';
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
 * Server en rooster rekenen per deel hetzelfde en steunen sinds deze stap op
 * één regel, `deelVenster` (shared/busvakTijd.ts): de server via
 * `deelMinuten`, het rooster via `shiftWindowMinutes`. De kerncijfers wijken
 * af voor invoer die in de praktijk kan voorkomen en zijn daarom NIET
 * samengevoegd: welke uitkomst juist is, is een beslissing voor Jarno.
 */

/** src/lib/shiftTime.ts `shiftWindowMinutes` zoals het op main (3926fee) stond. */
const oudVenster = (s: { startTime: string; endTime: string }): { start: number; end: number } | null => {
  const lees = (t: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 47 || min > 59) return null;
    return h * 60 + min;
  };
  const start = lees(s.startTime);
  const end = lees(s.endTime);
  if (start === null || end === null) return null;
  return { start, end: end <= start ? end + 1440 : end };
};
/** api/helpers.ts `dienstMinuten` zoals het op main (3926fee) stond, voor één deel. */
const oudServerDeel = (a: unknown, b: unknown): number | null => {
  const lees = (t: string): number | null => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 47 || min > 59) return null;
    return h * 60 + min;
  };
  const start = lees(String(a ?? ''));
  const eind = lees(String(b ?? ''));
  if (start === null || eind === null) return null;
  return (eind <= start ? eind + 24 * 60 : eind) - start;
};

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

describe('waar ze uiteenlopen (niet samengevoegd, beslissing voor Jarno)', () => {
  it('over middernacht met gewone uren, 22:00 tot 06:00: de kerncijfers slaan het deel over', () => {
    expect(meet([['22:00', '06:00']])).toEqual({ server: 480, kerncijfers: null, rooster: 480, maandprint: 480 });
  });

  it('eindigt om 00:00, 16:00 tot 00:00: de kerncijfers slaan het deel over', () => {
    expect(meet([['16:00', '00:00']])).toEqual({ server: 480, kerncijfers: null, rooster: 480, maandprint: 480 });
  });

  it('gesplitst met een nachtdeel in gewone uren: de kerncijfers tellen alleen het dagdeel', () => {
    expect(meet([['17:00', '20:00'], ['22:00', '02:30']])).toEqual({ server: 450, kerncijfers: 180, rooster: 450, maandprint: 450 });
  });

  it('gelijke begin- en eindtijd, 08:00 tot 08:00: 24 uur voor server, rooster en maandprint, 0 voor de kerncijfers', () => {
    expect(meet([['08:00', '08:00']])).toEqual({ server: 1440, kerncijfers: 0, rooster: 1440, maandprint: 1440 });
  });

  it('gelijke begin- en eindtijd om middernacht, 00:00 tot 00:00', () => {
    expect(meet([['00:00', '00:00']])).toEqual({ server: 1440, kerncijfers: 0, rooster: 1440, maandprint: 1440 });
  });

  it('dagdeel plus een deel met gelijke tijden: een verschil van 24 uur', () => {
    expect(meet([['06:00', '14:00'], ['15:00', '15:00']])).toEqual({ server: 1920, kerncijfers: 480, rooster: 1920, maandprint: 1920 });
  });

  it('tijden met seconden, 06:00:00 tot 14:00:00: de kerncijfers lezen ze niet', () => {
    expect(meet([['06:00:00', '14:00:00']])).toEqual({ server: 480, kerncijfers: null, rooster: 480, maandprint: 480 });
  });

  it('geen leesbare tijden: null op de server en bij de kerncijfers, 0 op het rooster en de maandprint', () => {
    expect(meet([['', '']])).toEqual({ server: null, kerncijfers: null, rooster: 0, maandprint: 0 });
    expect(meet([['x', '08:00']])).toEqual({ server: null, kerncijfers: null, rooster: 0, maandprint: 0 });
  });

  it('een tijd buiten de grenzen, 06:00 tot 48:00: alleen de maandprint rekent door', () => {
    expect(meet([['06:00', '48:00']])).toEqual({ server: null, kerncijfers: null, rooster: 0, maandprint: 2520 });
  });
});

describe('deelVenster en deelMinuten: de gedeelde rekenregel van server en rooster', () => {
  const GEVALLEN: Array<[string | null | undefined, string | null | undefined, number | null]> = [
    ['06:00', '14:00', 480],
    ['6:00', '14:00', 480],
    ['22:00', '26:16', 256],
    ['22:00', '06:00', 480],
    ['16:00', '24:00', 480],
    ['16:00', '00:00', 480],
    ['08:00', '08:00', 1440],
    ['00:00', '00:00', 1440],
    ['24:30', '06:00', 330],
    ['06:00:00', '14:00:00', 480],
    [' 06:00 ', '14:00', 480],
    ['', '', null],
    ['06:00', '', null],
    ['x', '08:00', null],
    ['06:00', '48:00', null],
    ['06:00', '07:60', null],
    [null, undefined, null],
  ];

  it('geeft voor elk deel wat de server vroeger gaf', () => {
    for (const [a, b, verwacht] of GEVALLEN) {
      expect(oudServerDeel(a, b), `oud ${a} tot ${b}`).toBe(verwacht);
      expect(deelMinuten(a, b), `${a} tot ${b}`).toBe(verwacht);
      expect(server({ startTime: a, endTime: b }), `server ${a} tot ${b}`).toBe(verwacht);
    }
  });

  it('shiftWindowMinutes (Mijn dag, dashboard, rooster) geeft voor elk deel het venster van vroeger', () => {
    for (const [a, b] of GEVALLEN) {
      const rij = { startTime: a as string, endTime: b as string };
      const oud = oudVenster(rij);
      expect(shiftWindowMinutes(rij), `venster ${a} tot ${b}`).toEqual(oud);
      expect(deelVenster(a, b), `deelVenster ${a} tot ${b}`).toEqual(oud);
    }
  });

  it('het rooster geeft voor elk deel wat het vroeger gaf (0 zonder leesbare tijden)', () => {
    for (const [a, b, verwacht] of GEVALLEN) {
      const rij = { startTime: a as string, endTime: b as string };
      const venster = oudVenster(rij);
      const oud = venster ? venster.end - venster.start : 0;
      expect(oud, `oud ${a} tot ${b}`).toBe(verwacht ?? 0);
      expect(rooster(rij), `rooster ${a} tot ${b}`).toBe(oud);
    }
  });

  it('de server telt de delen op en slaat een onleesbaar deel over', () => {
    expect(server({ startTime: '06:00', endTime: '09:00', startTime2: '--', endTime2: '--', startTime3: '15:00', endTime3: '18:30' })).toBe(390);
    expect(server({ startTime: null, endTime: null })).toBeNull();
    expect(server({})).toBeNull();
  });
});
