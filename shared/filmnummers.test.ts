import { describe, expect, it } from 'vitest';
import {
  LEGE_FILMNUMMERLIJST, MAX_FILM_TEKST, filmnummerTelling, leesFilmnummer, normaliseerFilmnummers, parseFilmnummerLijst, verdeelFilmnummers, zoekFilmnummers,
  type Filmnummer,
} from './filmnummers';
import { filmnummersSchema } from './schemas/filmnummers';

const f = (code: string, lijn: string, tekst: string): Filmnummer => ({ code, lijn, tekst });

// Een stuk van de echte lijst (01-10): algemene boodschappen, gewone lijnen en
// een G-lijn waarvan de code niet met het lijnnummer begint.
const LIJST: Filmnummer[] = [
  f('1', '', 'Geen dienst'),
  f('50', '', 'Fijne feestdagen!'),
  f('94', '', 'Stelplaats'),
  f('123', '', '100% Electric'),
  f('5000', '50', 'Brugge Station'),
  f('5004', '50', 'Eeklo Station'),
  f('5056', 'G50', 'Eeklo Markt via Mariakerke P'),
  f('5660', '56', 'Eeklo Station'),
  f('8580', '858', 'Aalter Station via Nevele'),
  f('8714', '871', 'Aalter Europalaan'),
];

describe('filmnummers, lezen en normaliseren', () => {
  it('een filmnummer is 1 tot 6 cijfers met een tekst; de lijn mag leeg zijn', () => {
    expect(leesFilmnummer({ code: ' 5000 ', lijn: ' 50 ', tekst: '  Brugge   Station ' })).toEqual(f('5000', '50', 'Brugge Station'));
    expect(leesFilmnummer({ code: 1, tekst: 'Geen dienst' })).toEqual(f('1', '', 'Geen dienst'));
    expect(leesFilmnummer({ code: '58A', lijn: '', tekst: 'x' })).toBeNull();
    expect(leesFilmnummer({ code: '1234567', lijn: '', tekst: 'x' })).toBeNull();
    expect(leesFilmnummer({ code: '12', lijn: '', tekst: '   ' })).toBeNull();
    expect(leesFilmnummer({ code: '12', lijn: '', tekst: 'x'.repeat(MAX_FILM_TEKST + 1) })).toBeNull();
    expect(leesFilmnummer({ code: '12', lijn: 'een veel te lange lijn', tekst: 'x' })).toBeNull();
    expect(leesFilmnummer(null)).toBeNull();
    expect(leesFilmnummer('5000')).toBeNull();
  });

  it('normaliseren: ongeldige rijen weg, elke code één keer (de eerste wint), oplopend op nummer', () => {
    const uit = normaliseerFilmnummers([f('5000', '50', 'Brugge Station'), f('94', '', 'Stelplaats'), { code: 'x', tekst: 'weg' }, f('5000', '50', 'Dubbel'), f('1', '', 'Geen dienst')]);
    expect(uit.map((x) => x.code)).toEqual(['1', '94', '5000']);
    expect(uit[2].tekst).toBe('Brugge Station');
    // Op de waarde van het nummer, niet als tekst: 94 komt vóór 123.
    expect(normaliseerFilmnummers([f('123', '', 'a'), f('94', '', 'b')]).map((x) => x.code)).toEqual(['94', '123']);
  });

  it('parseFilmnummerLijst: onbekende invoer wordt een geldige lijst, anders leeg', () => {
    expect(parseFilmnummerLijst(null)).toEqual(LEGE_FILMNUMMERLIJST);
    expect(parseFilmnummerLijst([])).toEqual(LEGE_FILMNUMMERLIJST);
    expect(parseFilmnummerLijst({ items: 'nee' })).toEqual(LEGE_FILMNUMMERLIJST);
    expect(parseFilmnummerLijst({ items: [f('2', '', 'Even pauze'), { code: '' }], bijgewerktOp: '2026-10-01T13:00:00.000Z' })).toEqual({
      items: [f('2', '', 'Even pauze')],
      bijgewerktOp: '2026-10-01T13:00:00.000Z',
    });
    expect(parseFilmnummerLijst({ items: [], bijgewerktOp: 'gisteren' }).bijgewerktOp).toBeNull();
  });
});

describe('filmnummers, indeling en zoeken', () => {
  it('bestemmingen per lijn bij elkaar (cijferlijnen oplopend, dan de letterlijnen), algemeen apart', () => {
    const v = verdeelFilmnummers(LIJST);
    expect(v.lijnen).toEqual(['50', '56', '858', '871', 'G50']);
    expect(v.bestemmingen.map((x) => x.code)).toEqual(['5000', '5004', '5660', '8580', '8714', '5056']);
    expect(v.algemeen.map((x) => x.code)).toEqual(['1', '50', '94', '123']);
    expect(verdeelFilmnummers([])).toEqual({ lijnen: [], bestemmingen: [], algemeen: [] });
  });

  it('sorteert de lijnen op hun getal, niet als tekst: 9 vóór 50, G5 vóór G12', () => {
    const v = verdeelFilmnummers([f('5000', '50', 'a'), f('1200', 'G12', 'b'), f('9000', '9', 'c'), f('1050', 'G5', 'd'), f('8580', '858', 'e')]);
    expect(v.lijnen).toEqual(['9', '50', '858', 'G5', 'G12']);
    expect(v.bestemmingen.map((x) => x.code)).toEqual(['9000', '5000', '8580', '1050', '1200']);
  });

  it('zoekt op lijn, bestemming of nummer; elk woord moet raken, accenten en hoofdletters tellen niet', () => {
    const codes = (zoek: string) => zoekFilmnummers(LIJST, zoek).map((x) => x.code);
    expect(codes('')).toHaveLength(LIJST.length);
    expect(codes('brugge')).toEqual(['5000']);
    expect(codes('EEKLO station')).toEqual(['5004', '5660']);
    expect(codes('871')).toEqual(['8714']);
    expect(codes('5660')).toEqual(['5660']);
    expect(codes('électric')).toEqual(['123']);
    expect(codes('aalter eur')).toEqual(['8714']);
    expect(codes('bestaat niet')).toEqual([]);
  });

  it('een nummer raakt een code alleen vanaf het begin, een lijn ook middenin', () => {
    // 158 heeft "58" middenin de code en geen lijn of tekst die het vangt.
    const metMidden = [...LIJST, f('158', '', 'Schoolrit')];
    const codes = (zoek: string) => zoekFilmnummers(metMidden, zoek).map((x) => x.code);
    // "58": lijn 858 (middenin), niet de code 158.
    expect(codes('58')).toEqual(['8580']);
    expect(codes('15')).toEqual(['158']);
    // "50": het algemene nummer 50, de codes 50xx en de lijnen 50 en G50.
    expect(codes('50')).toEqual(['50', '5000', '5004', '5056']);
  });

  it('het woord "lijn" in de zoekterm telt niet mee: "lijn 50" zoekt 50', () => {
    const codes = (zoek: string) => zoekFilmnummers(LIJST, zoek).map((x) => x.code);
    expect(codes('lijn 871')).toEqual(codes('871'));
    expect(codes('Lijn 871')).toEqual(['8714']);
    expect(codes('lijn 50')).toEqual(codes('50'));
    // Alleen het woord, nog geen nummer: de hele lijst blijft staan.
    expect(codes('lijn ')).toHaveLength(LIJST.length);
  });

  it('telt nummers en lijnen in woorden', () => {
    expect(filmnummerTelling(LIJST)).toBe('10 filmnummers voor 5 lijnen');
    expect(filmnummerTelling([f('1', '', 'Geen dienst')])).toBe('1 filmnummer');
    expect(filmnummerTelling([f('5000', '50', 'Brugge Station')])).toBe('1 filmnummer voor 1 lijn');
  });
});

describe('filmnummers, schema van de PUT-body', () => {
  it('laat door wat de lezers doorlaten en maakt een ontbrekende lijn leeg', () => {
    const r = filmnummersSchema.safeParse([{ code: ' 5000 ', lijn: '50', tekst: ' Brugge Station ' }, { code: '1', lijn: null, tekst: 'Geen dienst' }, { code: '2', tekst: 'Even pauze' }]);
    expect(r.success).toBe(true);
    expect(r.data).toEqual([f('5000', '50', 'Brugge Station'), f('1', '', 'Geen dienst'), f('2', '', 'Even pauze')]);
  });

  it('weigert een lege lijst, een code met letters en een lege tekst', () => {
    expect(filmnummersSchema.safeParse([]).success).toBe(false);
    expect(filmnummersSchema.safeParse([{ code: '58A', lijn: '', tekst: 'x' }]).success).toBe(false);
    expect(filmnummersSchema.safeParse([{ code: '58', lijn: '', tekst: ' ' }]).success).toBe(false);
  });
});
