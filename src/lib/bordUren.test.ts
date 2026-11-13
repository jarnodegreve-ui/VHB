import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { dienstUrenOpBord, dienstUrenUitPlanning, type BordPerMaand } from './bordUren';
import type { MonthCell } from './monthPlanning';
import type { Shift } from '../types';

const dienst = (code: string, segments: string[], extra: Partial<MonthCell> = {}): MonthCell =>
  ({ code, kind: 'service', label: `Dienst ${code}`, segments, ...extra });

/** Het bord van november en december zoals GET /api/month-planning het geeft (per maand de cellen). */
const BORD: BordPerMaand = {
  '2026-11': {
    '7': {
      '2026-11-12': dienst('2109', ['06:45–10:00 (loop 4500)', '15:45–19:35 (loop 4611)']),
      '2026-11-13': dienst('4101', ['06:12–14:30']),
      '2026-11-14': { code: 'bv', kind: 'absence', label: 'Betaald verlof', segments: [] },
      '2026-11-16': { code: '4101/4205', kind: 'unknown', label: 'Onbekende code', segments: [] },
      // Dezelfde dienst op een andere dag: het bord geeft de uren van díe dag
      // (dagtype of dienstregelingversie), en alleen die worden gelezen.
      '2026-11-18': dienst('4101', ['07:02–15:10 (loop 4700)']),
    },
    '9': { '2026-11-12': dienst('2304', ['05:10–13:02']) },
  },
  '2026-12': { '7': { '2026-12-01': dienst('2109', ['06:45–10:00', '15:45–19:35', '20:10–22:40']) } },
};

describe('dienstUrenOpBord: de uren van een dienst uit de cel van die dag', () => {
  it('een gesplitste dienst geeft elk deel, in de volgorde van het bord', () => {
    expect(dienstUrenOpBord(BORD, '7', '2026-11-12', '2109')).toEqual(['06:45–10:00', '15:45–19:35']);
    expect(dienstUrenOpBord(BORD, '7', '2026-12-01', '2109')?.join(' · ')).toBe('06:45–10:00 · 15:45–19:35 · 20:10–22:40');
  });

  it('laat de loopnummers weg', () => {
    expect(dienstUrenOpBord(BORD, '7', '2026-11-12', '2109')?.join(' · ')).toBe('06:45–10:00 · 15:45–19:35');
    expect(dienstUrenOpBord(BORD, '7', '2026-11-18', '4101')).toEqual(['07:02–15:10']);
  });

  it('leest de uren van díe dag: dezelfde dienst op twee dagen geeft twee keer wat het bord die dag zegt', () => {
    expect(dienstUrenOpBord(BORD, '7', '2026-11-13', '4101')).toEqual(['06:12–14:30']);
    expect(dienstUrenOpBord(BORD, '7', '2026-11-18', '4101')).toEqual(['07:02–15:10']);
  });

  it('de dienst staat die dag niet (meer) in de cel van die persoon: geen uren', () => {
    // Een andere dienst in de cel, een afwezigheid, geen cel, een andere persoon.
    expect(dienstUrenOpBord(BORD, '7', '2026-11-13', '2109')).toBeNull();
    expect(dienstUrenOpBord(BORD, '7', '2026-11-14', '2109')).toBeNull();
    expect(dienstUrenOpBord(BORD, '7', '2026-11-15', '2109')).toBeNull();
    expect(dienstUrenOpBord(BORD, '9', '2026-11-12', '2109')).toBeNull();
    expect(dienstUrenOpBord(BORD, '8', '2026-11-12', '2109')).toBeNull();
  });

  it('twee diensten in één cel: geen uren, de tijden van een cel zijn niet per dienst te splitsen', () => {
    expect(dienstUrenOpBord(BORD, '7', '2026-11-16', '4101')).toBeNull();
    expect(dienstUrenOpBord(BORD, '7', '2026-11-16', '4205')).toBeNull();
    // Ook als zo'n cel ooit tijden zou dragen: de code is niet die ene dienst.
    const metTijden: BordPerMaand = { '2026-11': { '7': { '2026-11-16': dienst('4101/4205', ['06:00–10:00', '14:00–18:00']) } } };
    expect(dienstUrenOpBord(metTijden, '7', '2026-11-16', '4101')).toBeNull();
    // En een samengestelde vraag raadt evenmin: de wizard biedt ze niet aan.
    expect(dienstUrenOpBord(BORD, '7', '2026-11-13', '4101/4205')).toBeNull();
  });

  it('een dienst onder een afwezigheid (hiddenService) heeft geen uren in de cel: niets', () => {
    const bord: BordPerMaand = { '2026-11': { '7': { '2026-11-12': { code: 'ziek', kind: 'absence', label: 'Ziek', segments: [], hiddenService: '2109' } } } };
    expect(dienstUrenOpBord(bord, '7', '2026-11-12', '2109')).toBeNull();
  });

  it('het bord van die maand is niet geladen, mislukt of nog onderweg: geen uren', () => {
    expect(dienstUrenOpBord({}, '7', '2026-11-12', '2109')).toBeNull();
    expect(dienstUrenOpBord({ '2026-11': null }, '7', '2026-11-12', '2109')).toBeNull();
    expect(dienstUrenOpBord({ '2026-11': undefined }, '7', '2026-11-12', '2109')).toBeNull();
    // Alleen december is binnen: een dienst in november blijft zonder uren.
    expect(dienstUrenOpBord({ '2026-12': BORD['2026-12'] }, '7', '2026-11-12', '2109')).toBeNull();
  });

  it('een antwoord in een onverwachte vorm geeft niets, en gooit niet', () => {
    const vreemd = (cellen: unknown) => dienstUrenOpBord({ '2026-11': cellen as BordPerMaand[string] }, '7', '2026-11-12', '2109');
    expect(vreemd([])).toBeNull();
    expect(vreemd('fout')).toBeNull();
    expect(vreemd({ '7': 5 })).toBeNull();
    expect(vreemd({ '7': { '2026-11-12': 'dienst' } })).toBeNull();
    expect(vreemd({ '7': { '2026-11-12': { code: '2109', kind: 'service' } } })).toBeNull();
    expect(vreemd({ '7': { '2026-11-12': { code: '2109', kind: 'service', segments: '06:45–10:00' } } })).toBeNull();
    expect(vreemd({ '7': { '2026-11-12': { code: '2109', kind: 'service', segments: [] } } })).toBeNull();
    expect(vreemd({ '7': { '2026-11-12': { code: '2109', kind: 'service', segments: [null] } } })).toBeNull();
  });

  it('één onleesbaar deel: liever niets dan een halve dienst', () => {
    const bord = (segments: string[]): BordPerMaand => ({ '2026-11': { '7': { '2026-11-12': dienst('2109', segments) } } });
    expect(dienstUrenOpBord(bord(['06:45–10:00', 'namiddag']), '7', '2026-11-12', '2109')).toBeNull();
    expect(dienstUrenOpBord(bord(['06:45–', '15:45–19:35']), '7', '2026-11-12', '2109')).toBeNull();
    expect(dienstUrenOpBord(bord(['06:45–10:00 en later']), '7', '2026-11-12', '2109')).toBeNull();
  });

  it('zonder persoon, dag of code: niets', () => {
    expect(dienstUrenOpBord(BORD, undefined, '2026-11-12', '2109')).toBeNull();
    expect(dienstUrenOpBord(BORD, '7', undefined, '2109')).toBeNull();
    expect(dienstUrenOpBord(BORD, '7', '2026-11-12', '')).toBeNull();
    expect(dienstUrenOpBord(BORD, '7', '2026-11-12', '--')).toBeNull();
  });

  it('vergelijkt de code zoals de planning dat doet (hoofdletters, spaties) en leest ook de oude schrijfwijze met een koppelteken', () => {
    const bord: BordPerMaand = { '2026-11': { '7': { '2026-11-12': dienst(' eek1 ', ['07:30 - 08:45']) } } };
    expect(dienstUrenOpBord(bord, '7', '2026-11-12', 'EEK1')).toEqual(['07:30–08:45']);
    expect(dienstUrenOpBord(bord, 7, '2026-11-12', 'EEK1')).toEqual(['07:30–08:45']);
  });
});

describe('dienstUrenUitPlanning: de dienst die de kijker zelf afgeeft', () => {
  const rij = (id: string, date: string, startTime: string, endTime: string, line: string, driverId = '42'): Shift =>
    ({ id, date, startTime, endTime, line, busNumber: '', loopnr: '4500', driverId });
  const PLANNING = [
    rij('b', '2026-11-20', '15:45', '19:35', '2109'),
    rij('a', '2026-11-20', '06:45', '10:00', '2109'),
    rij('c', '2026-11-21', '06:12', '14:30', '4101'),
    rij('d', '2026-11-20', '05:00', '13:00', '2109', '7'),
  ];

  it('alle delen van de dienst op één regel, vroegste eerst, zonder loopnummer', () => {
    expect(dienstUrenUitPlanning(PLANNING, '42', '2026-11-20', '2109')?.join(' · ')).toBe('06:45–10:00 · 15:45–19:35');
    expect(dienstUrenUitPlanning(PLANNING, '42', '2026-11-21', '4101')).toEqual(['06:12–14:30']);
  });

  it('niet zijn dienst, niet die dag, een vrije dag of een lege planning: niets', () => {
    expect(dienstUrenUitPlanning(PLANNING, '42', '2026-11-21', '2109')).toBeNull();
    expect(dienstUrenUitPlanning(PLANNING, '42', '2026-11-20', '4101')).toBeNull();
    expect(dienstUrenUitPlanning(PLANNING, '42', '2026-11-20', 'vrij')).toBeNull();
    expect(dienstUrenUitPlanning(PLANNING, '42', '2026-11-20', '')).toBeNull();
    expect(dienstUrenUitPlanning([], '42', '2026-11-20', '2109')).toBeNull();
    // De rij van een collega telt nooit mee.
    expect(dienstUrenUitPlanning(PLANNING, '7', '2026-11-20', '2109')).toEqual(['05:00–13:00']);
  });
});

// Dienstruil vraagt het bord zelf op, niet via fetchMonthPlanning: die import
// trok een extra bestand in de warmup van de chauffeur (gemeten 11-11). Het
// verzoek staat dus op twee plekken (tegenlezing 12-11). Wijzigt dat van de
// Maandplanning (pad of parameter), dan moet Dienstruil mee, anders leest het
// een ander antwoord en een andere sleutel in de cache van de service worker.
describe('het bordverzoek van Dienstruil volgt fetchMonthPlanning', () => {
  const lees = (bestand: string) => fs.readFileSync(path.resolve(__dirname, bestand), 'utf8');
  /** Elk verzoek naar het bord in de bron, met de ingevulde waarde weggelaten. */
  const verzoeken = (bron: string) => [...bron.matchAll(/`(\/api\/month-planning[^`]*)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, '{}'));

  it('zelfde pad en dezelfde parameter, één keer in elk bestand', () => {
    expect(verzoeken(lees('./monthPlanning.ts'))).toEqual(['/api/month-planning?month={}']);
    expect(verzoeken(lees('../views/SwapRequestsView.tsx'))).toEqual(verzoeken(lees('./monthPlanning.ts')));
  });
});
