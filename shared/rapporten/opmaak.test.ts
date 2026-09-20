import { describe, expect, it } from 'vitest';
import type { RapportDefinitie, RapportRij } from './types';
import { berekenTotalen, csvRijen, formatAantal, formatDuur, formatWaarde, heeftTotaalrij, isRechts, kolomIndeling, onderEersteTekst, rijBevat, sorteerRijen } from './opmaak';
import { RAPPORTEN, rapportVan } from './register';

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

describe('kolomIndeling (rol van een kolom op een smal scherm)', () => {
  const SMAL: RapportDefinitie = {
    ...DEF,
    kolommen: [
      { id: 'naam', titel: 'Naam', type: 'tekst', smal: 'verberg' }, // de eerste kolom negeert haar rol
      { id: 'sectie', titel: 'Sectie', type: 'tekst', smal: 'onderEerste' },
      { id: 'datum', titel: 'Datum', type: 'datum', smal: 'onderEerste' },
      { id: 'dagen', titel: 'Dagen', type: 'getal', totaal: true },
      { id: 'aangevraagd', titel: 'Aangevraagd', kort: 'Aangevr.', type: 'getal', smal: 'achteraan' },
      { id: 'gewerkt', titel: 'Gewerkt', type: 'duur', totaal: true },
      { id: 'attest', titel: 'Attest', type: 'janee', smal: 'verberg' },
      { id: 'opmerking', titel: 'Opmerking', type: 'tekst', smal: 'achteraan' },
    ],
  };
  const ids = (kolommen: { id: string }[]) => kolommen.map((k) => k.id);

  it('breed: alle kolommen in de volgorde van de definitie, niets onder de eerste', () => {
    const uit = kolomIndeling(SMAL, 'breed');
    expect(ids(uit.kolommen)).toEqual(ids([...SMAL.kolommen]));
    expect(uit.onderEerste).toEqual([]);
  });

  it('smal: onderEerste wordt een regel, achteraan schuift naar het einde, verberg valt weg', () => {
    const uit = kolomIndeling(SMAL, 'smal');
    expect(ids(uit.kolommen)).toEqual(['naam', 'dagen', 'gewerkt', 'aangevraagd', 'opmerking']);
    expect(ids(uit.onderEerste)).toEqual(['sectie', 'datum']);
  });

  it('de eerste kolom blijft de eerste, wat haar rol ook zegt', () => {
    expect(kolomIndeling(SMAL, 'smal').kolommen[0].id).toBe('naam');
  });

  it('een definitie zonder rollen is smal en breed hetzelfde', () => {
    expect(kolomIndeling(DEF, 'smal')).toEqual(kolomIndeling(DEF, 'breed'));
  });

  it('de invoer blijft ongemoeid en een lege definitie geeft niets', () => {
    const voor = ids([...SMAL.kolommen]);
    kolomIndeling(SMAL, 'smal').kolommen.reverse();
    expect(ids([...SMAL.kolommen])).toEqual(voor);
    expect(kolomIndeling({ ...DEF, kolommen: [] }, 'smal')).toEqual({ kolommen: [], onderEerste: [] });
  });

  it('onderEersteTekst: opgemaakte waarden met een middenpunt ertussen, lege overgeslagen', () => {
    const { onderEerste } = kolomIndeling(SMAL, 'smal');
    expect(onderEersteTekst(onderEerste, { id: '1', sectie: 'Nachtdiensten', datum: '2026-09-17' })).toBe('Nachtdiensten · 17/09/2026');
    expect(onderEersteTekst(onderEerste, { id: '2', sectie: null, datum: '2026-09-17' })).toBe('17/09/2026');
    expect(onderEersteTekst(onderEerste, { id: '3', sectie: '', datum: null })).toBe('');
    expect(onderEersteTekst([], { id: '4', sectie: 'Flexi' })).toBe('');
  });

  it('printblad en CSV kennen de rol niet: csvRijen geeft altijd alle kolommen', () => {
    expect(csvRijen(SMAL, [])[0]).toEqual(['Naam', 'Sectie', 'Datum', 'Dagen', 'Aangevraagd', 'Gewerkt', 'Attest', 'Opmerking']);
  });

  it('Verlofsaldo op de telefoon: naam (met sectie eronder), Budget, Opgenomen, Vrij; de rest achter het scrollen', () => {
    const uit = kolomIndeling(rapportVan('verlofsaldo')!, 'smal');
    expect(ids(uit.kolommen)).toEqual(['naam', 'budget', 'opgenomen', 'vrij', 'aangevraagd', 'kleinVerlet']);
    expect(ids(uit.onderEerste)).toEqual(['sectie']);
  });

  it('in het register: de eerste kolom heeft geen rol, en wat in de totaalrij telt verdwijnt nooit', () => {
    for (const r of RAPPORTEN) {
      expect(r.kolommen[0].smal, r.id).toBeUndefined();
      for (const k of r.kolommen) if (k.totaal) expect(k.smal === 'verberg' || k.smal === 'onderEerste', `${r.id}.${k.id}`).toBe(false);
    }
  });
});
