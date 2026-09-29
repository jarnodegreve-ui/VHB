// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseHHMM, parseHHMMStrikt } from '../shared/busvakTijd';
import { eindtijdMinuten } from '../shared/dienstGereden';
import { dagVenster } from '../shared/ruilRust';
import { buildVevent } from '../shared/ics';
import { parseUurNotatie } from '../shared/dienst/tijd';
import { dienstMinuten as dienstMinutenServer } from '../api/helpers';
import { getServiceSegments } from '../api/storage';
import { bouwDienstenPerDag } from '../api/_lib/rapporten/planning';
import { isValidBusvakTime, normalizeTimeString, parseHHMM as parseHHMMClient } from './lib/shiftTime';
import { dienstMinuten as dienstMinutenStatistiek } from './lib/dienstStatistiek';

/**
 * Vergelijkingstest van de HH:MM-parsers (opruim 28, stap 1).
 *
 * Vóór de samenvoeging stonden er negen parsers in de code. Hieronder staan
 * ze letterlijk zoals ze op main (3926fee) stonden, als referentie, en de
 * tabel legt vast wat elk van hen met dezelfde invoer deed. Daarnaast wordt
 * elke parser die vandaag in de code zit gemeten langs zijn publieke functie:
 * na de samenvoeging moet elke aanroepplek nog hetzelfde antwoord geven als
 * zijn oude parser.
 *
 * Wie samengevoegd is en wie bewust bleef staan:
 * - leest het begin, tot 47:59 (groep LEES): api/helpers.ts, shared/ruilRust.ts,
 *   shared/dienstGereden.ts (en via die laatste src/lib/shiftTime.ts).
 *   Drie keer dezelfde code → `parseHHMM` uit shared/busvakTijd.ts.
 * - eist de hele tekst, tot 47:59 (groep STRIKT): src/lib/dienstStatistiek.ts en
 *   api/storage.ts. Twee keer dezelfde regel → `parseHHMMStrikt`.
 * - blijven staan: api/_lib/rapporten/planning.ts (geen bovengrens, nooit null,
 *   alleen voor de volgorde), shared/ics.ts (verdraagt alles, nooit null),
 *   shared/dienst/tijd.ts (de uurnotatie van De Lijn, '07u24', geen bovengrens)
 *   en `normalizeTimeString` (maakt tekst van tekst, geen minuten).
 */

// --- De oude parsers, letterlijk ------------------------------------------------
const MAX = Number.MAX_SAFE_INTEGER;

/** api/helpers.ts `parseBusvakMinuten`, shared/ruilRust.ts `parseBusvakMin` en
 *  shared/dienstGereden.ts `eindtijdMinuten`: drie keer deze code. */
const oudLees = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
};
/** src/lib/dienstStatistiek.ts `parseMinuten`. */
const oudStatistiek = (t?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const u = Number(m[1]);
  const min = Number(m[2]);
  if (u > 47 || min > 59) return null;
  return u * 60 + min;
};
/** api/storage.ts `isValidHHMM`. */
const oudStorage = (v?: string): boolean => {
  if (!v) return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return false;
  return Number(m[1]) <= 47 && Number(m[2]) <= 59;
};
/** api/_lib/rapporten/planning.ts `minutenVan` (krijgt de getrimde tekst). */
const oudRapport = (tijd: string): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec(tijd);
  return m ? Number(m[1]) * 60 + Number(m[2]) : MAX;
};
/** shared/ics.ts `toMinutes`. */
const oudIcs = (hhmm: string): number => {
  const [h, m] = String(hhmm).split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
};
/** shared/dienst/tijd.ts `parseUurNotatie`. */
const oudUurNotatie = (t: string | null | undefined): number | null => {
  const s = String(t ?? '').trim().toLowerCase();
  const m = /^(\d{1,2})[u:h.](\d{2})$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
};

// --- De tabel ---------------------------------------------------------------------
// invoer | LEES | STRIKT | storage | rapport | ics | uurnotatie
type Rij = [invoer: string | null | undefined, lees: number | null, strikt: number | null, storage: boolean, rapport: number, ics: number, uur: number | null];
const TABEL: Rij[] = [
  // Geldig: overal hetzelfde.
  ['07:05', 425, 425, true, 425, 425, 425],
  ['7:05', 425, 425, true, 425, 425, 425],
  ['00:00', 0, 0, true, 0, 0, 0],
  ['23:59', 1439, 1439, true, 1439, 1439, 1439],
  ['24:00', 1440, 1440, true, 1440, 1440, 1440],
  ['26:16', 1576, 1576, true, 1576, 1576, 1576],
  ['47:59', 2879, 2879, true, 2879, 2879, 2879],
  // Met spaties errond: overal hetzelfde (iedereen trimt, of krijgt getrimde tekst).
  [' 07:05 ', 425, 425, true, 425, 425, 425],
  ['07:05 ', 425, 425, true, 425, 425, 425],
  ['\t07:05', 425, 425, true, 425, 425, 425],
  // Buiten de grenzen: de busvak-parsers weigeren, rapport, ics en uurnotatie rekenen door.
  ['48:00', null, null, false, 2880, 2880, 2880],
  ['07:60', null, null, false, 480, 480, 480],
  // Met seconden of rommel achteraan: LEES en rapport lezen het begin, STRIKT en storage weigeren.
  ['07:05:00', 425, null, false, 425, 425, null],
  ['07:05:30', 425, null, false, 425, 425, null],
  ['26:16:00', 1576, null, false, 1576, 1576, null],
  ['07:05abc', 425, null, false, 425, 420, null],
  ['07:055', 425, null, false, 425, 475, null],
  // Eén cijfer voor de minuten: alleen ics maakt er iets van.
  ['7:5', null, null, false, MAX, 425, null],
  ['07:5', null, null, false, MAX, 425, null],
  // Spatie in het midden: alleen ics.
  ['07 :05', null, null, false, MAX, 425, null],
  ['07: 05', null, null, false, MAX, 425, null],
  // Andere scheidingstekens: alleen de uurnotatie van De Lijn leest ze.
  ['07u05', null, null, false, MAX, 0, 425],
  ['25u10', null, null, false, MAX, 0, 1510],
  ['07.05', null, null, false, MAX, 423, 425],
  // Geen tijd.
  ['0705', null, null, false, MAX, 42300, null],
  ['abc', null, null, false, MAX, 0, null],
  ['-1:00', null, null, false, MAX, -60, null],
  ['', null, null, false, MAX, 0, null],
  [null, null, null, false, MAX, 0, null],
  [undefined, null, null, false, MAX, 0, null],
];
const naam = (v: unknown) => JSON.stringify(v) ?? 'undefined';
const alsTekst = (v: unknown): string => String(v ?? '').trim();

describe('de oude parsers: waar ze hetzelfde deden en waar niet', () => {
  for (const [invoer, lees, strikt, storage, rapport, ics, uur] of TABEL) {
    it(`${naam(invoer)}`, () => {
      expect(oudLees(invoer as string), 'helpers / ruilRust / dienstGereden').toBe(lees);
      expect(oudStatistiek(invoer as string), 'dienstStatistiek').toBe(strikt);
      expect(oudStorage(invoer as string), 'storage').toBe(storage);
      expect(oudRapport(alsTekst(invoer)), 'rapporten/planning').toBe(rapport);
      expect(oudIcs(invoer as string), 'ics').toBe(ics);
      expect(oudUurNotatie(invoer), 'uurnotatie').toBe(uur);
    });
  }

  it('de twee strikte parsers zeggen voor elke invoer hetzelfde', () => {
    for (const [invoer] of TABEL) expect(oudStorage(invoer as string), naam(invoer)).toBe(oudStatistiek(invoer as string) !== null);
  });

  it('voor een gewone tijd (UU:MM tot 47:59, spaties errond mogen) geven alle parsers hetzelfde getal', () => {
    for (const [invoer, lees, strikt, , rapport, ics, uur] of TABEL.slice(0, 10)) {
      expect(new Set([lees, strikt, rapport, ics, uur]).size, naam(invoer)).toBe(1);
    }
  });
});

describe('de gedeelde parser tegenover de oude', () => {
  it('parseHHMM = de oude leesparser, voor elke invoer', () => {
    for (const [invoer] of TABEL) expect(parseHHMM(invoer), naam(invoer)).toBe(oudLees(invoer as string));
  });
  it('parseHHMMStrikt = de oude strikte parser, voor elke invoer', () => {
    for (const [invoer] of TABEL) {
      expect(parseHHMMStrikt(invoer), naam(invoer)).toBe(oudStatistiek(invoer as string));
      expect(parseHHMMStrikt(invoer) !== null, naam(invoer)).toBe(oudStorage(invoer as string));
    }
  });
  it('een getal of een object gooit niet', () => {
    for (const v of [705, 0, {}, [], true]) {
      expect(parseHHMM(v)).toBeNull();
      expect(parseHHMMStrikt(v)).toBeNull();
    }
  });
});

describe('elke aanroepplek geeft nog wat haar oude parser gaf', () => {
  const invoeren = TABEL.map(([invoer]) => invoer);

  it('shared/dienstGereden.ts eindtijdMinuten', () => {
    for (const t of invoeren) expect(eindtijdMinuten(t as string), naam(t)).toBe(oudLees(t as string));
  });

  it('src/lib/shiftTime.ts parseHHMM en isValidBusvakTime', () => {
    for (const t of invoeren) {
      expect(parseHHMMClient(t as string), naam(t)).toBe(oudLees(t as string));
      expect(isValidBusvakTime(t as string), naam(t)).toBe(oudLees(t as string) !== null);
    }
  });

  it('shared/ruilRust.ts dagVenster (start van het venster)', () => {
    for (const t of invoeren) {
      // 47:59 tot 47:59 heeft gelijke begin- en eindtijd: ongeldig, geen
      // venster (Jarno 29-09; vroeger een venster van een etmaal vanaf 47:59).
      const verwacht = t === '47:59' ? null : oudLees(t as string);
      const venster = dagVenster([{ startTime: t as string, endTime: '47:59' }]);
      expect(venster?.start ?? null, naam(t)).toBe(verwacht);
    }
  });

  it('api/helpers.ts dienstMinuten (einde van één deel dat om 00:00 begint)', () => {
    for (const t of invoeren) {
      const p = oudLees(t as string);
      // Gelijke begin- en eindtijd (00:00 tot 00:00) is ongeldig: null (Jarno
      // 29-09; vroeger telde einde ≤ start als nacht en was het een etmaal).
      const verwacht = p === null || p === 0 ? null : p;
      expect(dienstMinutenServer({ startTime: '00:00', endTime: t }), naam(t)).toBe(verwacht);
    }
  });

  it('src/lib/dienstStatistiek.ts dienstMinuten (einde van één deel dat om 00:00 begint)', () => {
    for (const t of invoeren) {
      const dienst = { id: 'x', serviceNumber: 'x', startTime: '00:00', endTime: t as string };
      // De kerncijfers keuren nog strikt (oudStatistiek), maar 00:00 tot 00:00
      // is sinds 29-09 ongeldig: null in plaats van 0.
      const p = oudStatistiek(t as string);
      expect(dienstMinutenStatistiek(dienst), naam(t)).toBe(p === 0 ? null : p);
    }
  });

  it('api/storage.ts getServiceSegments (een deel telt alleen met twee geldige tijden)', () => {
    for (const t of invoeren) {
      const alsStart = getServiceSegments({ id: 's', serviceNumber: '1', startTime: t, endTime: '10:00' } as never);
      const alsEinde = getServiceSegments({ id: 's', serviceNumber: '1', startTime: '10:00', endTime: t } as never);
      expect(alsStart.length === 1, `start ${naam(t)}`).toBe(oudStorage(t as string));
      expect(alsEinde.length === 1, `einde ${naam(t)}`).toBe(oudStorage(t as string));
    }
  });

  it('api/_lib/rapporten/planning.ts: de volgorde van de delen volgt de oude minutenVan (geen bovengrens)', () => {
    // Twee delen van dezelfde dienst: het deel met de te meten starttijd en een
    // deel om 12:00. Wie eerst komt zegt of minutenVan onder of boven 720 uitkwam.
    for (const t of invoeren) {
      const planning = [
        { id: 'meet', date: '2026-09-29', startTime: t, endTime: '13:00', line: '2101', driverId: '1' },
        { id: 'vast', date: '2026-09-29', startTime: '12:00', endTime: '13:00', line: '2101', driverId: '1' },
      ];
      const uit = bouwDienstenPerDag({ planning, users: [] }, { van: '2026-09-29', tot: '2026-09-29', keuzes: {} } as never);
      const eerste = uit.rijen.find((r) => r.deel === 1)?.id;
      const oud = oudRapport(alsTekst(t));
      // Gelijk aan 720 komt in de tabel niet voor; bij gelijke stand beslist het id.
      expect(eerste, naam(t)).toBe(oud < 720 ? 'meet' : 'vast');
    }
  });

  it('api/_lib/rapporten/planning.ts wijkt bewust af van parseHHMM: "07:60" en "48:00" sorteren op hun getal', () => {
    expect(oudRapport('07:60')).toBe(480);
    expect(parseHHMM('07:60')).toBeNull();
    expect(oudRapport('48:00')).toBe(2880);
    expect(parseHHMM('48:00')).toBeNull();
  });

  it('shared/ics.ts: het einde van de afspraak volgt de oude toMinutes (verdraagt alles)', () => {
    const minutenNa = (dtend: string): number => {
      const m = /^DTEND:(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})00$/.exec(dtend);
      if (!m) throw new Error(`onleesbare DTEND: ${dtend}`);
      const dag = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return (dag - Date.UTC(2026, 8, 29)) / 60000 + Number(m[4]) * 60 + Number(m[5]);
    };
    for (const t of invoeren) {
      const ruw = oudIcs(t as string);
      // Een negatief getal ("-1:00") geeft geen geldige DTEND; dat is de bestaande toestand en hoort niet bij deze meting.
      if (ruw < 0) continue;
      const regels = buildVevent({ uid: 'u', date: '2026-09-29', startTime: '00:00', endTime: t as string, summary: 's' }, '20260929T000000Z');
      const dtend = regels.find((r) => r.startsWith('DTEND:'));
      // Einde gelijk aan de start (00:00): geen blok van een etmaal meer maar
      // een afspraak zonder DTEND, nul minuten op het begintijdstip (Jarno
      // 29-09; vroeger DTEND de dag erna om 00:00).
      if (ruw === 0) {
        expect(dtend, naam(t)).toBeUndefined();
        continue;
      }
      expect(minutenNa(dtend!), naam(t)).toBe(ruw);
    }
  });

  it('shared/dienst/tijd.ts parseUurNotatie', () => {
    for (const t of invoeren) expect(parseUurNotatie(t), naam(t)).toBe(oudUurNotatie(t));
  });

  it('normalizeTimeString vult alleen een geldige vorm aan en laat de rest staan', () => {
    expect(normalizeTimeString('7:05')).toBe('07:05');
    expect(normalizeTimeString(' 7:05 ')).toBe('07:05');
    expect(normalizeTimeString('26:16')).toBe('26:16');
    expect(normalizeTimeString('07:05:00')).toBe('07:05:00');
    expect(normalizeTimeString('7:5')).toBe('7:5');
  });
});

describe('bestaand verschil, niet opgelost: het formulier leest, de opbouw keurt', () => {
  it('"07:05:00" is geldig voor het dienstformulier (isValidBusvakTime) en ongeldig voor de planningsopbouw (getServiceSegments)', () => {
    expect(isValidBusvakTime('07:05:00')).toBe(true);
    expect(getServiceSegments({ id: 's', serviceNumber: '1', startTime: '07:05:00', endTime: '10:00' } as never)).toHaveLength(0);
  });
});
