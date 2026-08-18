import { describe, it, expect } from 'vitest';
import {
  dagVenster,
  addDagen,
  rustTovVorigeDag,
  rustTovVolgendeDag,
  dagenNaElkaarMet,
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

describe('sorteerKandidaten: passend eerst, dan minste dagen op rij, dan eerlijk verdeeld', () => {
  const maak = (name: string, past: boolean, dagen: number, keren: number): KandidaatAdvies => ({
    id: name, name, rustVoor: null, rustNa: null, dagenNaElkaar: dagen, keren, past, redenen: past ? [] : ['x'],
  });

  it('sorteert op past → dagenNaElkaar → keren → naam', () => {
    const volgorde = sorteerKandidaten([
      maak('Zoë', true, 1, 2),
      maak('An', false, 1, 0),
      maak('Bert', true, 4, 0),
      maak('Ann', true, 1, 2),
      maak('Cas', true, 1, 0),
    ]).map((k) => k.name);
    // Cas wint van Ann/Zoë (zelfde reeks, minder ingevallen); Bert werkt al
    // 4 dagen op rij en zakt onder hen; An past niet en sluit af.
    expect(volgorde).toEqual(['Cas', 'Ann', 'Zoë', 'Bert', 'An']);
  });

  it('de reeks werkdagen weegt zwaarder dan de invalteller (keuze Jarno)', () => {
    const volgorde = sorteerKandidaten([
      maak('Veel-ingevallen-maar-uitgerust', true, 1, 5),
      maak('Nooit-ingevallen-maar-5e-dag', true, 5, 0),
    ]).map((k) => k.name);
    expect(volgorde).toEqual(['Veel-ingevallen-maar-uitgerust', 'Nooit-ingevallen-maar-5e-dag']);
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
    id: name, name, rustVoor: null, rustNa: null, dagenNaElkaar: 1, keren: 0,
    past, redenen: past ? [] : ['maar 6u30 rust na de dienst van de dag ervoor'], ...extra,
  });
  const ketting = { vanId: 'd', vanNaam: 'Dirk', viaCode: '4101', viaTijden: '08:00–16:00', naarId: 'e', naarNaam: 'Eric' };

  it('noemt de beste kandidaat mét waarom, en de tweede keuze', () => {
    const tekst = adviesSamenvatting({ code: '2603', kandidaten: [k('Danny', true, { rustVoor: 12 * 60 }), k('Bart', true)], kettingen: [] });
    expect(tekst).toBe('Ik zou Danny vragen — geen aansluitende werkdagen, rust 12u, nog niet ingevallen dit jaar. Bart is de logische tweede keuze.');
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
