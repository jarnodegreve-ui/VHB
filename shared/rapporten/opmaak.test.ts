import { describe, expect, it } from 'vitest';
import type { RapportDefinitie, RapportRij } from './types';
import { berekenTotalen, csvRijen, formatAantal, formatDuur, formatWaarde, heeftTotaalrij, isRechts, rijBevat, sorteerRijen } from './opmaak';

const DEF: RapportDefinitie = {
  id: 'test',
  domein: 'uren',
  titel: 'Test',
  omschrijving: 'Test',
  filters: [],
  kolommen: [
    { id: 'naam', titel: 'Naam', type: 'tekst' },
    { id: 'datum', titel: 'Datum', type: 'datum' },
    { id: 'dagen', titel: 'Dagen', type: 'getal', totaal: true },
    { id: 'gewerkt', titel: 'Gewerkt', type: 'duur', totaal: true },
    { id: 'attest', titel: 'Attest', type: 'janee' },
  ],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'staand',
  bronNaam: 'testgegevens',
};
const [NAAM, DATUM, DAGEN, GEWERKT, ATTEST] = DEF.kolommen;

const RIJEN: RapportRij[] = [
  { id: 'b', naam: 'Bert', datum: '2026-09-17', dagen: 2.5, gewerkt: 455, attest: true },
  { id: 'a', naam: 'anna', datum: '2026-01-05', dagen: 10, gewerkt: 1500, attest: false },
  { id: 'c', naam: 'Onbekend (99)', datum: null, dagen: 0, gewerkt: -30, attest: null },
];

describe('opmaak per kolomtype', () => {
  it('duur = minuten als u:mm, uren lopen door boven 24, negatief met min', () => {
    expect(formatDuur(0)).toBe('0:00');
    expect(formatDuur(5)).toBe('0:05');
    expect(formatDuur(125)).toBe('2:05');
    expect(formatDuur(1650)).toBe('27:30');
    expect(formatDuur(-30)).toBe('-0:30');
  });

  it('getal met decimale komma, zonder duizendtallen', () => {
    expect(formatAantal(0)).toBe('0');
    expect(formatAantal(12.5)).toBe('12,5');
    expect(formatAantal(1234)).toBe('1234');
    expect(formatAantal(1 / 3)).toBe('0,33');
  });

  it('datum in beeld dd/mm/jjjj, in de CSV ISO', () => {
    expect(formatWaarde(DATUM, '2026-09-17')).toBe('17/09/2026');
    expect(formatWaarde(DATUM, '2026-09-17', 'csv')).toBe('2026-09-17');
  });

  it('ja/nee, en leeg als streep in beeld maar als lege cel in de CSV', () => {
    expect(formatWaarde(ATTEST, true)).toBe('ja');
    expect(formatWaarde(ATTEST, false)).toBe('nee');
    expect(formatWaarde(ATTEST, null)).toBe('—');
    expect(formatWaarde(NAAM, null, 'csv')).toBe('');
  });

  it('nul blijft "0": een rapport verzwijgt geen nul', () => {
    expect(formatWaarde(DAGEN, 0)).toBe('0');
    expect(formatWaarde(GEWERKT, 0)).toBe('0:00');
  });

  it('getal en duur staan rechts, tenzij de definitie anders zegt', () => {
    expect(DEF.kolommen.map(isRechts)).toEqual([false, false, true, true, false]);
    expect(isRechts({ ...DAGEN, uitlijning: 'links' })).toBe(false);
  });
});

describe('totalen', () => {
  it('telt alleen de kolommen met `totaal`, duur in minuten', () => {
    expect(berekenTotalen(DEF, RIJEN)).toEqual({ dagen: 12.5, gewerkt: 1925 });
    expect(heeftTotaalrij(DEF)).toBe(true);
  });

  it('nul rijen = totaal 0 (niet leeg)', () => {
    expect(berekenTotalen(DEF, [])).toEqual({ dagen: 0, gewerkt: 0 });
    expect(formatWaarde(DAGEN, berekenTotalen(DEF, []).dagen)).toBe('0');
  });

  it('een niet-getal in een getalkolom telt niet mee', () => {
    expect(berekenTotalen(DEF, [{ id: 'x', dagen: null, gewerkt: 'n.v.t.' }, { id: 'y', dagen: 3, gewerkt: 60 }])).toEqual({ dagen: 3, gewerkt: 60 });
  });
});

describe('sorteren en zoeken', () => {
  it('tekst zonder hoofdlettergevoeligheid, getallen als getal, leeg achteraan', () => {
    expect(sorteerRijen(DEF, RIJEN, 'naam', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sorteerRijen(DEF, RIJEN, 'dagen', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sorteerRijen(DEF, RIJEN, 'gewerkt', 'asc').map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(sorteerRijen(DEF, RIJEN, 'datum', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(sorteerRijen(DEF, RIJEN, 'datum', 'desc').map((r) => r.id)).toEqual(['b', 'a', 'c']);
  });

  it('een onbekende kolom valt terug op de eerste, de invoer blijft ongemoeid', () => {
    const kopie = [...RIJEN];
    expect(sorteerRijen(DEF, RIJEN, 'bestaat-niet', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(RIJEN).toEqual(kopie);
  });

  it('rijBevat zoekt in elke kolom', () => {
    expect(rijBevat(DEF, RIJEN[0], 'BERT')).toBe(true);
    expect(rijBevat(DEF, RIJEN[0], '2026-09')).toBe(true);
    expect(rijBevat(DEF, RIJEN[0], 'anna')).toBe(false);
    expect(rijBevat(DEF, RIJEN[0], '  ')).toBe(true);
  });
});

describe('csvRijen', () => {
  it('kopregel, rijen en de totaalrij', () => {
    expect(csvRijen(DEF, RIJEN.slice(0, 2), berekenTotalen(DEF, RIJEN.slice(0, 2)))).toEqual([
      ['Naam', 'Datum', 'Dagen', 'Gewerkt', 'Attest'],
      ['Bert', '2026-09-17', '2,5', '7:35', 'ja'],
      ['anna', '2026-01-05', '10', '25:00', 'nee'],
      ['Totaal', '', '12,5', '32:35', ''],
    ]);
  });

  it('zonder rijen alleen de kopregel (geen totaalrij met nullen)', () => {
    expect(csvRijen(DEF, [], berekenTotalen(DEF, []))).toEqual([['Naam', 'Datum', 'Dagen', 'Gewerkt', 'Attest']]);
  });
});
