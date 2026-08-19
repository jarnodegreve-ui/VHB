import { describe, it, expect } from 'vitest';
import {
  dagVenster,
  addDagen,
  rustTovVorigeDag,
  rustTovVolgendeDag,
  dagenNaElkaarMet,
  maandagVan,
  dagenInWeekVan,
  dagenInMaandVan,
  beoordeelKandidaat,
  sorteerKandidaten,
  zoekKettingen,
  adviesSamenvatting,
  tijdenLabel,
  formatUren,
  MIN_RUST_UREN,
  MAX_WERKDAGEN_NA_ELKAAR,
  type KandidaatAdvies,
  type KettingPersoon,
  type KettingWerkende,
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

  it('een schoolvervoerchauffeur springt niet in op een lijndienst', () => {
    const k = advies({ sectie: 'Schoolvervoer' });
    expect(k.past).toBe(false);
    expect(k.redenen).toEqual(['schoolvervoerchauffeur — springt niet in op een lijndienst']);
    // Ruim matchen: een hernoemde sectie blijft herkend; andere secties niet.
    expect(advies({ sectie: 'schoolvervoer 2' }).past).toBe(false);
    expect(advies({ sectie: 'Reguliere' }).past).toBe(true);
    expect(advies({ sectie: null }).past).toBe(true);
  });
});

describe('week- en maandtelling van gewerkte dagen', () => {
  it('maandagVan vindt de maandag van de week (ma–zo)', () => {
    expect(maandagVan('2026-08-19')).toBe('2026-08-17'); // woensdag
    expect(maandagVan('2026-08-17')).toBe('2026-08-17'); // maandag zelf
    expect(maandagVan('2026-08-23')).toBe('2026-08-17'); // zondag hoort er nog bij
  });

  it('telt alleen dagen in de week van het gat, de dag zelf niet', () => {
    const gewerkt = new Set(['2026-08-17', '2026-08-18', '2026-08-23', '2026-08-24']);
    // 24-08 is de maandag van de vólgende week en telt niet mee; 19-08 zelf ook niet.
    expect(dagenInWeekVan(gewerkt, '2026-08-19')).toBe(3);
    expect(dagenInWeekVan(new Set(['2026-08-19']), '2026-08-19')).toBe(0);
  });

  it('telt de kalendermaand van het gat, over weekgrenzen heen', () => {
    const gewerkt = new Set(['2026-08-01', '2026-08-15', '2026-08-31', '2026-07-31', '2026-09-01']);
    expect(dagenInMaandVan(gewerkt, '2026-08-19')).toBe(3);
  });
});

describe('sorteerKandidaten: passend eerst, dan minst gewerkt die week, dan reeks, dan maandtotaal', () => {
  const maak = (name: string, past: boolean, week: number, reeks: number, maand: number): KandidaatAdvies => ({
    id: name, name, rustVoor: null, rustNa: null, dagenNaElkaar: reeks,
    dagenDezeWeek: week, dagenDezeMaand: maand, keren: 0, past, redenen: past ? [] : ['x'],
  });

  it('sorteert op past → dagenDezeWeek → dagenNaElkaar → dagenDezeMaand → naam', () => {
    const volgorde = sorteerKandidaten([
      maak('Zoë', true, 2, 1, 8),
      maak('An', false, 0, 1, 0),
      maak('Bert', true, 2, 4, 8),
      maak('Ann', true, 2, 1, 8),
      maak('Cas', true, 1, 3, 12),
    ]).map((k) => k.name);
    // Cas werkte deze week het minst en wint ondanks langere reeks en hoger
    // maandtotaal; Ann/Zoë zijn gelijk en vallen terug op naam; Bert zakt op
    // zijn langere reeks; An past niet en sluit af.
    expect(volgorde).toEqual(['Cas', 'Ann', 'Zoë', 'Bert', 'An']);
  });

  it('het maandtotaal beslist bij gelijke week en reeks (keuze Jarno 19-08)', () => {
    const volgorde = sorteerKandidaten([
      maak('Veel-deze-maand', true, 1, 2, 14),
      maak('Weinig-deze-maand', true, 1, 2, 6),
    ]).map((k) => k.name);
    expect(volgorde).toEqual(['Weinig-deze-maand', 'Veel-deze-maand']);
  });

  it('de invalteller doet niet meer mee in de volgorde', () => {
    const volgorde = sorteerKandidaten([
      { ...maak('Vaak-ingevallen-niets-gewerkt', true, 0, 1, 0), keren: 9 },
      { ...maak('Nooit-ingevallen-een-dag-gewerkt', true, 1, 1, 1), keren: 0 },
    ]).map((k) => k.name);
    expect(volgorde).toEqual(['Vaak-ingevallen-niets-gewerkt', 'Nooit-ingevallen-een-dag-gewerkt']);
  });
});

describe('weergave-helpers', () => {
  it('formatUren/formatRustUren: compacte urennotatie, nooit negatief', () => {
    expect(formatUren(8 * 60)).toBe('8u');
    expect(formatUren(6 * 60 + 5)).toBe('6u05');
    expect(formatRustUren(-30)).toBe('0u');
  });

  it('kandidaatMeta: bindende (krapste) rust + reeks + week-/maandtelling', () => {
    const k: KandidaatAdvies = {
      id: '1', name: 'Test', rustVoor: 11 * 60 + 30, rustNa: 9 * 60,
      dagenNaElkaar: 4, dagenDezeWeek: 2, dagenDezeMaand: 8, keren: 2, past: true, redenen: [],
    };
    expect(kandidaatMeta(k)).toBe('rust 9u · 4e werkdag op rij · 2 dagen deze week · 8 deze maand');
    expect(kandidaatMeta({ ...k, rustVoor: null, rustNa: null, dagenNaElkaar: 1, dagenDezeWeek: 1, dagenDezeMaand: 1 })).toBe('1 dag deze week · 1 deze maand');
  });

  it('segmentenLabel: tijdsblokken als contextregel', () => {
    expect(segmentenLabel([
      { startTime: '06:12', endTime: '09:30' },
      { startTime: '15:41', endTime: '18:20' },
    ])).toBe('06:12–09:30 + 15:41–18:20');
  });
});

describe('zoekKettingen: ruil in één stap als niemand direct past', () => {
  const persoon = (naam: string, extra: Partial<KettingPersoon> = {}): KettingPersoon => ({
    id: naam, name: naam, sectie: null, vorigeDag: [], volgendeDag: [],
    gewerkteDagen: new Set<string>(), keren: 0, ...extra,
  });
  const werkende = (naam: string, code: string, rijen: KettingWerkende['rijen'], extra: Partial<KettingPersoon> = {}): KettingWerkende => ({
    ...persoon(naam, { gewerkteDagen: new Set(['2026-08-20']), ...extra }), dienstCode: code, rijen,
  });
  const venster = { start: 6 * 60, eind: 14 * 60 }; // het gat: 06:00–14:00

  it('vindt de ruil: werkende staat zijn dienst af, vrije collega neemt hem over', () => {
    // Eric is vrij maar werkte gisteren tot 23:30 → te weinig rust vóór 06:00,
    // wél genoeg vóór 08:00. Dirk (werkt 08:00–16:00) kan het gat rijden.
    const kettingen = zoekKettingen({
      datum: '2026-08-20',
      dienstVenster: venster,
      werkenden: [werkende('Dirk', '4101', [{ startTime: '08:00', endTime: '16:00' }])],
      vrijen: [persoon('Eric', { vorigeDag: [{ startTime: '15:00', endTime: '23:30' }] })],
    });
    expect(kettingen).toEqual([{
      vanId: 'Dirk', vanNaam: 'Dirk', viaCode: '4101', viaTijden: '08:00–16:00', naarId: 'Eric', naarNaam: 'Eric',
    }]);
  });

  it('geen ketting als de vrijgekomen dienst óók niet past bij de vrije collega', () => {
    // Nachtdienst tot 26:00 gisteren: zelfs 08:00 laat maar 6u rust over.
    const kettingen = zoekKettingen({
      datum: '2026-08-20',
      dienstVenster: venster,
      werkenden: [werkende('Dirk', '4101', [{ startTime: '08:00', endTime: '16:00' }])],
      vrijen: [persoon('Eric', { vorigeDag: [{ startTime: '18:00', endTime: '26:00' }] })],
    });
    expect(kettingen).toEqual([]);
  });

  it('een schoolvervoerchauffeur schuift niet door naar het gat', () => {
    const kettingen = zoekKettingen({
      datum: '2026-08-20',
      dienstVenster: venster,
      werkenden: [werkende('Sara', '4101', [{ startTime: '08:00', endTime: '16:00' }], { sectie: 'Schoolvervoer' })],
      vrijen: [persoon('Eric')],
    });
    expect(kettingen).toEqual([]);
  });

  it('zonder tijden van de open dienst geen voorstellen (rustcheck onmogelijk)', () => {
    const kettingen = zoekKettingen({
      datum: '2026-08-20',
      dienstVenster: null,
      werkenden: [werkende('Dirk', '4101', [{ startTime: '08:00', endTime: '16:00' }])],
      vrijen: [persoon('Eric')],
    });
    expect(kettingen).toEqual([]);
  });

  it('tijdenLabel sorteert gesplitste rijen op starttijd', () => {
    expect(tijdenLabel([
      { startTime: '15:41', endTime: '18:20' },
      { startTime: '06:12', endTime: '09:30' },
    ])).toBe('06:12–09:30 + 15:41–18:20');
  });
});

describe('adviesSamenvatting: de collega-zin', () => {
  const k = (name: string, past: boolean, extra: Partial<KandidaatAdvies> = {}): KandidaatAdvies => ({
    id: name, name, rustVoor: null, rustNa: null, dagenNaElkaar: 1,
    dagenDezeWeek: 0, dagenDezeMaand: 0, keren: 0,
    past, redenen: past ? [] : ['maar 6u30 rust na de dienst van de dag ervoor'], ...extra,
  });
  const ketting = { vanId: 'd', vanNaam: 'Dirk', viaCode: '4101', viaTijden: '08:00–16:00', naarId: 'e', naarNaam: 'Eric' };

  it('noemt de beste kandidaat mét waarom, en de tweede keuze', () => {
    const tekst = adviesSamenvatting({ code: '2603', kandidaten: [k('Danny', true, { rustVoor: 12 * 60 }), k('Bart', true)], kettingen: [] });
    expect(tekst).toBe('Ik zou Danny vragen — geen aansluitende werkdagen, rust 12u, nog geen werkdag deze week. Bart is de logische tweede keuze.');
  });

  it('valt terug op de ruil als niemand direct past', () => {
    const tekst = adviesSamenvatting({ code: '2603', kandidaten: [k('Bart', false)], kettingen: [ketting] });
    expect(tekst).toContain('Wél mogelijk via een ruil');
    expect(tekst).toContain('laat Eric dienst 4101 (08:00–16:00) overnemen van Dirk');
  });

  it('benoemt wie het dichtst in de buurt komt als ook een ruil niet lukt', () => {
    const tekst = adviesSamenvatting({ code: '2603', kandidaten: [k('Bart', false)], kettingen: [] });
    expect(tekst).toContain('Bart komt het dichtst in de buurt');
    expect(tekst).toContain('6u30 rust');
  });

  it('zegt het eerlijk als er die dag helemaal niemand vrij is', () => {
    expect(adviesSamenvatting({ code: '2603', kandidaten: [], kettingen: [] })).toContain('Niemand is vrij op deze dag');
  });
});
