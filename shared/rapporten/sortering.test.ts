import { describe, expect, it } from 'vitest';
import type { RapportDefinitie, RapportRij } from './types';
import { RAPPORTEN } from './register';
import { filterParams } from './filters';
import { metKolommen } from './opmaak';
import { SORTEER_PARAM, leesSortering, sorteerVolgens, sorteringNaarParam, standaardSortering, volgendeSortering } from './sortering';

const DEF: RapportDefinitie = {
  id: 'sorteer-test',
  domein: 'uren',
  titel: 'Test',
  omschrijving: 'Test',
  filters: [],
  kolommen: [
    { id: 'naam', titel: 'Naam', type: 'tekst' },
    { id: 'dagen', titel: 'Dagen', type: 'getal' },
    { id: 'maand', titel: 'Maand', type: 'tekst', sorteerOp: 'sleutel' },
    { id: 'datum', titel: 'Datum', type: 'datum' },
  ],
  sortering: { kolom: 'dagen', richting: 'desc' },
  print: 'staand',
  bronNaam: 'test',
};

const RIJEN: RapportRij[] = [
  { id: 'a', naam: 'bert', dagen: 3, maand: 'Augustus 2026', sleutel: '2026-08', datum: '2026-08-10' },
  { id: 'b', naam: 'Anna', dagen: null, maand: 'April 2026', sleutel: '2026-04', datum: null },
  { id: 'c', naam: 'Chris', dagen: 12, maand: 'December 2025', sleutel: '2025-12', datum: '2025-12-01' },
  { id: 'd', naam: 'dirk', dagen: 0, maand: 'Onbekend', sleutel: null, datum: '2026-01-02' },
];
const q = (s: string) => new URLSearchParams(s);
const ids = (rijen: RapportRij[]) => rijen.map((r) => r.id);

describe('sortering in de URL: lezen', () => {
  it('zonder parameter de standaard van de definitie', () => {
    expect(leesSortering(DEF, q(''))).toEqual({ kolom: 'dagen', richting: 'desc' });
    expect(standaardSortering(DEF)).toEqual({ kolom: 'dagen', richting: 'desc' });
  });

  it('`kolom` = oplopend, `-kolom` = aflopend', () => {
    expect(leesSortering(DEF, q('sorteer=naam'))).toEqual({ kolom: 'naam', richting: 'asc' });
    expect(leesSortering(DEF, q('sorteer=-naam'))).toEqual({ kolom: 'naam', richting: 'desc' });
    expect(leesSortering(DEF, q('sorteer=%20maand%20'))).toEqual({ kolom: 'maand', richting: 'asc' });
  });

  it('een onbekende kolom, een los minteken of een lege waarde: de standaard, geen fout', () => {
    for (const ruw of ['sorteer=bestaat-niet', 'sorteer=-', 'sorteer=', 'sorteer=--naam', 'sorteer=sleutel']) {
      expect(leesSortering(DEF, q(ruw)), ruw).toEqual(standaardSortering(DEF));
    }
  });

  it('een kolom die van de gegevens afhangt is geldig zodra ze in de effectieve definitie staat', () => {
    expect(leesSortering(DEF, q('sorteer=-type_x'))).toEqual(standaardSortering(DEF));
    const eff = metKolommen(DEF, [{ id: 'type_x', titel: 'X', type: 'getal' }]);
    expect(leesSortering(eff, q('sorteer=-type_x'))).toEqual({ kolom: 'type_x', richting: 'desc' });
  });
});

describe('sortering in de URL: schrijven', () => {
  it('de standaard laat de parameter weg', () => {
    expect(sorteringNaarParam(DEF, { kolom: 'dagen', richting: 'desc' })).toBeNull();
    expect(sorteringNaarParam(DEF, { kolom: 'dagen', richting: 'asc' })).toBe('dagen');
    expect(sorteringNaarParam(DEF, { kolom: 'naam', richting: 'desc' })).toBe('-naam');
  });

  it('heen en terug geeft dezelfde sortering', () => {
    for (const s of [{ kolom: 'naam', richting: 'asc' }, { kolom: 'maand', richting: 'desc' }, { kolom: 'dagen', richting: 'asc' }] as const) {
      expect(leesSortering(DEF, q(`${SORTEER_PARAM}=${sorteringNaarParam(DEF, s)}`))).toEqual(s);
    }
  });

  it('een klik: dezelfde kolom keert om, een andere begint oplopend', () => {
    expect(volgendeSortering({ kolom: 'dagen', richting: 'desc' }, 'dagen')).toEqual({ kolom: 'dagen', richting: 'asc' });
    expect(volgendeSortering({ kolom: 'dagen', richting: 'asc' }, 'dagen')).toEqual({ kolom: 'dagen', richting: 'desc' });
    expect(volgendeSortering({ kolom: 'dagen', richting: 'desc' }, 'naam')).toEqual({ kolom: 'naam', richting: 'asc' });
  });
});

describe('sorteerVolgens: één vergelijker voor scherm, blad en CSV', () => {
  it('leeg staat altijd achteraan, in beide richtingen', () => {
    expect(ids(sorteerVolgens(DEF, RIJEN, { kolom: 'dagen', richting: 'asc' }))).toEqual(['d', 'a', 'c', 'b']);
    expect(ids(sorteerVolgens(DEF, RIJEN, { kolom: 'dagen', richting: 'desc' }))).toEqual(['c', 'a', 'd', 'b']);
    expect(ids(sorteerVolgens(DEF, RIJEN, { kolom: 'datum', richting: 'desc' }))).toEqual(['a', 'd', 'c', 'b']);
  });

  it('tekst zonder hoofdlettergevoeligheid', () => {
    expect(ids(sorteerVolgens(DEF, RIJEN, { kolom: 'naam', richting: 'asc' }))).toEqual(['b', 'a', 'c', 'd']);
  });

  it('`sorteerOp`: sorteert op het verborgen veld, niet op de getoonde tekst, leeg achteraan', () => {
    expect(ids(sorteerVolgens(DEF, RIJEN, { kolom: 'maand', richting: 'asc' }))).toEqual(['c', 'b', 'a', 'd']);
    expect(ids(sorteerVolgens(DEF, RIJEN, { kolom: 'maand', richting: 'desc' }))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('de invoer blijft ongemoeid', () => {
    const kopie = [...RIJEN];
    sorteerVolgens(DEF, RIJEN, { kolom: 'naam', richting: 'desc' });
    expect(RIJEN).toEqual(kopie);
  });
});

describe('register', () => {
  it('geen filter heet `sorteer` of `zoek`, en elke standaardsortering wijst naar een bestaande kolom', () => {
    for (const def of RAPPORTEN) {
      expect(filterParams(def), def.id).not.toContain(SORTEER_PARAM);
      expect(filterParams(def), def.id).not.toContain('zoek');
      expect(def.kolommen.some((k) => k.id === def.sortering.kolom), def.id).toBe(true);
      expect(sorteringNaarParam(def, leesSortering(def, q(''))), def.id).toBeNull();
    }
  });
});
