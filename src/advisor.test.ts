import { describe, it, expect } from 'vitest';
import {
  dagVenster,
  addDagen,
  rustTovVorigeDag,
  rustTovVolgendeDag,
  dagenNaElkaarMet,
  beoordeelKandidaat,
  sorteerKandidaten,
  formatUren,
  MIN_RUST_UREN,
  MAX_WERKDAGEN_NA_ELKAAR,
  type KandidaatAdvies,
} from '../api/advisor';
import { kandidaatMeta, formatRustUren, segmentenLabel } from './lib/advisor';

/**
 * De twee harde regels van de openstaande-diensten-advisor (vraag Jarno
 * 17-08): minstens 8u rust t.o.v. de dienst van de dag ervoor/erna, en
 * maximum 6 gewerkte dagen na elkaar. De tijden volgen de busvak-notatie
 * van het dienstoverzicht ("26:16" = 02:16 de nacht erna).
 */

const advies = (extra: Partial<Parameters<typeof beoordeelKandidaat>[0]> = {}) =>
  beoordeelKandidaat({
    id: '1',
    name: 'Test',
    dienstVenster: { start: 6 * 60, eind: 14 * 60 },
    vorigeDag: [],
    volgendeDag: [],
    gewerkteDagen: new Set<string>(),
    datum: '2026-08-20',
    keren: 0,
    ...extra,
  });

describe('dagVenster: werkvenster van één dag', () => {
  it('neemt vroegste start en laatste einde over gesplitste rijen', () => {
    expect(dagVenster([
      { startTime: '15:41', endTime: '18:20' },
      { startTime: '06:12', endTime: '09:30' },
    ])).toEqual({ start: 6 * 60 + 12, eind: 18 * 60 + 20 });
  });

  it('begrijpt busvak-uren ≥ 24 als volgende-nacht', () => {
    expect(dagVenster([{ startTime: '18:00', endTime: '26:16' }])).toEqual({ start: 18 * 60, eind: 26 * 60 + 16 });
  });

  it('normaliseert een impliciete nachtdienst (einde ≤ start) met +24u', () => {
    expect(dagVenster([{ startTime: '22:00', endTime: '06:00' }])).toEqual({ start: 22 * 60, eind: 30 * 60 });
  });

  it('slaat kapotte tijden over; niets bruikbaar → null', () => {
    expect(dagVenster([{ startTime: '08:75', endTime: '16:00' }])).toBeNull();
    expect(dagVenster([])).toBeNull();
    expect(dagVenster([
      { startTime: 'x', endTime: 'y' },
      { startTime: '08:00', endTime: '16:00' },
    ])).toEqual({ start: 8 * 60, eind: 16 * 60 });
  });
});

describe('rusttijd t.o.v. de aansluitende werkdagen', () => {
  it('gisteren tot 22:00, vandaag om 06:00 begonnen = precies 8u', () => {
    expect(rustTovVorigeDag([{ startTime: '14:00', endTime: '22:00' }], 6 * 60)).toBe(8 * 60);
  });

  it('gisteren tot 23:30, vandaag om 06:00 = maar 6u30', () => {
    expect(rustTovVorigeDag([{ startTime: '15:00', endTime: '23:30' }], 6 * 60)).toBe(6 * 60 + 30);
  });

  it('een nachtdienst gisteren (tot 26:16) laat om 08:00 maar 5u44 over', () => {
    expect(rustTovVorigeDag([{ startTime: '18:00', endTime: '26:16' }], 8 * 60)).toBe(5 * 60 + 44);
  });

  it('geen dienst gisteren → null (geen beperking)', () => {
    expect(rustTovVorigeDag([], 6 * 60)).toBeNull();
  });

  it('spiegelbeeld: dienst tot 26:16 vandaag vs. morgen om 06:00 = 3u44', () => {
    expect(rustTovVolgendeDag([{ startTime: '06:00', endTime: '14:00' }], 26 * 60 + 16)).toBe(3 * 60 + 44);
  });
});

describe('dagenNaElkaarMet: de 6-dagenregel', () => {
  it('telt de reeks in beide richtingen, met de nieuwe dag erbij', () => {
    const gewerkt = new Set(['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-21', '2026-08-22']);
    // 17-18-19 + [20] + 21-22 = 6 dagen aaneengesloten.
    expect(dagenNaElkaarMet(gewerkt, '2026-08-20')).toBe(6);
  });

  it('een gat breekt de reeks', () => {
    const gewerkt = new Set(['2026-08-15', '2026-08-18', '2026-08-19']);
    expect(dagenNaElkaarMet(gewerkt, '2026-08-20')).toBe(3);
  });

  it('rekent over een maandgrens heen', () => {
    expect(addDagen('2026-08-01', -1)).toBe('2026-07-31');
    const gewerkt = new Set(['2026-07-30', '2026-07-31']);
    expect(dagenNaElkaarMet(gewerkt, '2026-08-01')).toBe(3);
  });
});

describe('beoordeelKandidaat: de regels samen', () => {
  it('precies 8u rust en 6 dagen op rij is nog passend', () => {
    const k = advies({
      vorigeDag: [{ startTime: '14:00', endTime: '22:00' }],
      gewerkteDagen: new Set(['2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19']),
    });
    expect(k.rustVoor).toBe(MIN_RUST_UREN * 60);
    expect(k.dagenNaElkaar).toBe(MAX_WERKDAGEN_NA_ELKAAR);
    expect(k.past).toBe(true);
    expect(k.redenen).toEqual([]);
  });

  it('te weinig rust én een 7e dag leveren allebei een reden op', () => {
    const k = advies({
      vorigeDag: [{ startTime: '15:00', endTime: '23:30' }],
      gewerkteDagen: new Set(['2026-08-14', '2026-08-15', '2026-08-16', '2026-08-17', '2026-08-18', '2026-08-19']),
    });
    expect(k.past).toBe(false);
    expect(k.redenen).toEqual([
      'maar 6u30 rust na de dienst van de dag ervoor',
      'zou 7 dagen na elkaar werken',
    ]);
  });

  it('de rust van morgen telt óók: een nachtdienst botst met een vroege start de dag erna', () => {
    const k = advies({
      dienstVenster: { start: 18 * 60, eind: 26 * 60 + 16 },
      volgendeDag: [{ startTime: '06:00', endTime: '14:00' }],
    });
    expect(k.past).toBe(false);
    expect(k.redenen).toEqual(['maar 3u44 rust vóór de dienst van de dag erna']);
  });

  it('zonder diensttijden geldt alleen de 6-dagenregel', () => {
    const k = advies({
      dienstVenster: null,
      vorigeDag: [{ startTime: '15:00', endTime: '23:59' }],
    });
    expect(k.rustVoor).toBeNull();
    expect(k.past).toBe(true);
  });
});

describe('sorteerKandidaten: passend eerst, dan eerlijk verdeeld', () => {
  it('sorteert op past → keren → naam', () => {
    const maak = (name: string, past: boolean, keren: number): KandidaatAdvies => ({
      id: name, name, rustVoor: null, rustNa: null, dagenNaElkaar: 1, keren, past, redenen: past ? [] : ['x'],
    });
    const volgorde = sorteerKandidaten([
      maak('Zoë', true, 2),
      maak('An', false, 0),
      maak('Bert', true, 0),
      maak('Ann', true, 0),
    ]).map((k) => k.name);
    expect(volgorde).toEqual(['Ann', 'Bert', 'Zoë', 'An']);
  });
});

describe('weergave-helpers', () => {
  it('formatUren/formatRustUren: compacte urennotatie, nooit negatief', () => {
    expect(formatUren(8 * 60)).toBe('8u');
    expect(formatUren(6 * 60 + 5)).toBe('6u05');
    expect(formatRustUren(-30)).toBe('0u');
  });

  it('kandidaatMeta: bindende (krapste) rust + reeks + invalteller', () => {
    const k: KandidaatAdvies = {
      id: '1', name: 'Test', rustVoor: 11 * 60 + 30, rustNa: 9 * 60,
      dagenNaElkaar: 4, keren: 2, past: true, redenen: [],
    };
    expect(kandidaatMeta(k)).toBe('rust 9u · 4e werkdag op rij · 2× ingevallen');
    expect(kandidaatMeta({ ...k, rustVoor: null, rustNa: null, dagenNaElkaar: 1, keren: 0 })).toBe('nog niet ingevallen');
  });

  it('segmentenLabel: tijdsblokken als contextregel', () => {
    expect(segmentenLabel([
      { startTime: '06:12', endTime: '09:30' },
      { startTime: '15:41', endTime: '18:20' },
    ])).toBe('06:12–09:30 + 15:41–18:20');
  });
});
