import { describe, expect, it } from 'vitest';
import { kalenderRijen, kalenderUitRijen, leesDatum, perDagVan, regimeVan, samenvatting, weekdagKortVan } from './dagtypeKalender';

const kop = ['datum', 'weekdag', 'typedag', 'regime', 'dienstregeling', 'max_verlof'];

describe('kalenderUitRijen', () => {
  it('leest het CSV van De Lijn: datum, typedag en max_verlof per rij, gesorteerd', () => {
    const uit = kalenderUitRijen([
      ['sep=,'],
      kop,
      ['2027-01-04', 'ma', '21', 'school', '21', '2'],
      ['2027-01-01', 'vr', '28', 'feestdag', '27', '0'],
      ['2027-01-02', 'za', '26', 'zaterdag', '26', '7'],
      ['', '', '', '', '', ''],
    ]);
    expect(uit.overgeslagen).toEqual([]);
    expect(uit.dagen).toEqual([
      { datum: '2027-01-01', typedag: '28', maxVerlof: 0 },
      { datum: '2027-01-02', typedag: '26', maxVerlof: 7 },
      { datum: '2027-01-04', typedag: '21', maxVerlof: 2 },
    ]);
  });

  it('slaat foute rijen over mét reden en houdt bij een dubbele datum de eerste', () => {
    const uit = kalenderUitRijen([
      kop,
      ['2027-01-04', 'ma', '21', 'school', '21', '2'],
      ['2027-01-04', 'ma', '31', 'vakantie', '31', '7'],
      ['04/01/2027', 'ma', '99', 'x', '99', '2'],
      ['niet-een-datum', 'ma', '21', 'school', '21', '2'],
      ['2027-01-05', 'di', '22', 'school', '22', 'veel'],
      ['2027-01-06', 'wo', '23', 'school', '23', ''],
    ]);
    expect(uit.dagen).toEqual([{ datum: '2027-01-04', typedag: '21', maxVerlof: 2 }, { datum: '2027-01-06', typedag: '23', maxVerlof: null }]);
    expect(uit.overgeslagen.map((o) => [o.regel, o.reden])).toEqual([
      [3, 'Dubbele datum, de eerste rij telt.'],
      [4, 'Onbekend dagtype “99”.'],
      [5, 'Geen leesbare datum.'],
      [6, 'Verlofmaximum “veel” is geen geheel getal tussen 0 en 200.'],
    ]);
  });

  it('zonder kopregel of zonder typedag-kolom: niets, met de reden', () => {
    expect(kalenderUitRijen([['2027-01-04', '21']]).overgeslagen[0].reden).toMatch(/kopregel/);
    expect(kalenderUitRijen([['datum', 'weekdag'], ['2027-01-04', 'ma']]).overgeslagen[0].reden).toMatch(/typedag/);
  });
});

describe('leesDatum', () => {
  it('ISO, dd/mm/jjjj, dd-mm-jjjj en een Excel-getal; een valse dag niet', () => {
    expect(leesDatum('2027-01-04')).toBe('2027-01-04');
    expect(leesDatum('4/1/2027')).toBe('2027-01-04');
    expect(leesDatum('04-01-2027')).toBe('2027-01-04');
    expect(leesDatum(46391)).toBe('2027-01-04');
    expect(leesDatum('2027-02-30')).toBeNull();
    expect(leesDatum('')).toBeNull();
  });
});

describe('regimeVan, weekdagKortVan, kalenderRijen, perDagVan, samenvatting', () => {
  it('werkt per code en bouwt de exportrijen in het formaat van het bestand', () => {
    expect(['21', '33', '43', '53', '26', '27', '28'].map(regimeVan)).toEqual(['school', 'vakantie', 'juli-augustus', 'examen', 'zaterdag', 'zondag', 'feestdag']);
    expect(weekdagKortVan('2027-01-01')).toBe('vr');
    expect(kalenderRijen([{ datum: '2027-01-01', typedag: '28', maxVerlof: 0 }, { datum: '2027-01-06', typedag: '23', maxVerlof: null }])).toEqual([
      ['datum', 'weekdag', 'typedag', 'regime', 'dienstregeling', 'max_verlof'],
      ['2027-01-01', 'vr', '28', 'feestdag', '27', 0],
      ['2027-01-06', 'wo', '23', 'school', '23', ''],
    ]);
    expect(perDagVan([{ datum: '2027-01-01', typedag: '28', maxVerlof: 0 }])).toEqual({ '2027-01-01': { typedag: '28', maxVerlof: 0 } });
    expect(perDagVan([])).toBeUndefined();
    expect(samenvatting([{ datum: '2027-01-01', typedag: '28', maxVerlof: 0 }, { datum: '2027-01-04', typedag: '21', maxVerlof: 2 }, { datum: '2027-01-05', typedag: '22', maxVerlof: 2 }]))
      .toEqual({ aantal: 3, eerste: '2027-01-01', laatste: '2027-01-05', perRegime: [{ regime: 'school', aantal: 2 }, { regime: 'feestdag', aantal: 1 }] });
  });
});
