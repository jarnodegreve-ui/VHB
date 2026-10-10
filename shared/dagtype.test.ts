import { describe, expect, it } from 'vitest';
import {
  DAGTYPE_GROEPEN, DAGTYPES, dagtypeKort, dagtypeLabel, dagtypePeriode, dagtypeVanDag, dagtypesKort, delenTekst, isDagtypeCode, kalenderUitDekking, tijdenOpDag,
  variantTekst, variantenAfdruk, variantenSchoon, variantVoor,
} from './dagtype';

describe('DAGTYPES', () => {
  it('kent de 23 codes van De Lijn met hun label', () => {
    expect(DAGTYPES).toHaveLength(23);
    expect(DAGTYPES.map((d) => d.code)).toEqual([
      '21', '22', '23', '24', '25', '31', '32', '33', '34', '35', '41', '42', '43', '44', '45', '51', '52', '53', '54', '55', '26', '27', '28',
    ]);
    expect(dagtypeLabel('23')).toBe('Woensdag schooldag');
    expect(dagtypeLabel('33')).toBe('Woensdag schoolvakantie');
    expect(dagtypeLabel('41')).toBe('Maandag juli-augustus');
    expect(dagtypeLabel('55')).toBe('Vrijdag examen');
    expect(dagtypeLabel('28')).toBe('Feestdag');
    expect(dagtypeLabel('99')).toBe('Dagtype 99');
    expect(isDagtypeCode('23')).toBe(true);
    expect(isDagtypeCode('20')).toBe(false);
    expect(isDagtypeCode(23)).toBe(false);
  });
});

// Productie-achtige dekkingsconfig: eigen namen per weekdag, een schooljaar-
// periode vanaf 1 september en feestdagen als uitzondering op "zondag".
const dekking = {
  __weekdagen__: ['zondag', 'vakantieperiode ma/di/wo', 'vakantieperiode ma/di/wo', 'vakantieperiode ma/di/wo', 'vakantieperiode donderdag', 'vakantieperiode vrijdag', 'zaterdag'],
  '__weekdagen_2026-09-01__': ['zondag', 'schooldag', 'schooldag dinsdag', 'woensdag', 'schooldag', 'schooldag vrijdag', 'zaterdag'],
  __uitzonderingen__: ['2026-11-11..2026-11-11|zondag', '2026-10-26..2026-10-30|herfstvakantie'],
  schooldag: ['2101'],
};
const kalender = kalenderUitDekking(dekking);

describe('kalenderUitDekking', () => {
  it('leest weekdagen, periodes en uitzonderingen uit de gereserveerde sleutels', () => {
    expect(kalender.weekdays[3]).toBe('vakantieperiode ma/di/wo');
    expect(kalender.perioden).toEqual([{ vanaf: '2026-09-01', weekdays: dekking['__weekdagen_2026-09-01__'] }]);
    expect(kalender.overrides).toHaveLength(2);
  });

  it('valt zonder config terug op de standaard weekdagen', () => {
    expect(kalenderUitDekking({}).weekdays).toEqual(['zondag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'zaterdag']);
    expect(kalenderUitDekking({}).perioden).toEqual([]);
  });
});

describe('dagtypeVanDag', () => {
  it('de code uit de matrix wint altijd', () => {
    expect(dagtypeVanDag('2026-10-14', '23', kalender)).toEqual({ code: '23', bron: 'excel' });
    expect(dagtypeVanDag('2026-10-14', ' 33 ', null)).toEqual({ code: '33', bron: 'excel' });
  });

  it('een naam in kolom B telt als het dagtype van die dag, zoals bij de dekking', () => {
    // Herfstvakantie zonder uitzondering in de dekking, maar wel in de Excel.
    expect(dagtypeVanDag('2026-10-28', 'vakantie', kalender)).toEqual({ code: '33', bron: 'excel' });
    // Een brugdag als "zondag" in de Excel.
    expect(dagtypeVanDag('2026-10-30', 'zondag', kalender)).toEqual({ code: '27', bron: 'excel' });
    // Oude imports: "week" is geen periode, dus schooldag op de weekdag.
    expect(dagtypeVanDag('2026-10-14', 'week', null)).toEqual({ code: '23', bron: 'excel' });
    expect(dagtypeVanDag('2026-10-14', 'week', kalender)).toEqual({ code: '23', bron: 'excel' });
    expect(dagtypeVanDag('2026-10-14', '', null)).toEqual({ code: '23', bron: 'weekdag' });
  });

  it('zonder kalender: weekdag als schooldag, weekend op de weekdag', () => {
    expect(dagtypeVanDag('2026-10-12').code).toBe('21');
    expect(dagtypeVanDag('2026-10-16').code).toBe('25');
    expect(dagtypeVanDag('2026-10-17').code).toBe('26');
    expect(dagtypeVanDag('2026-10-18').code).toBe('27');
  });

  it('met kalender: de periode uit het dagtype van die dag, de weekdag doet de rest', () => {
    // Schooljaarperiode: "woensdag" is een schooldag → 23.
    expect(dagtypeVanDag('2026-10-14', '', kalender)).toEqual({ code: '23', bron: 'kalender' });
    // Herfstvakantie als uitzondering: woensdag → 33.
    expect(dagtypeVanDag('2026-10-28', '', kalender)).toEqual({ code: '33', bron: 'kalender' });
    // Vóór 1 september geldt de basis: "vakantieperiode ma/di/wo" → 33.
    expect(dagtypeVanDag('2026-08-26', '', kalender)).toEqual({ code: '33', bron: 'kalender' });
    // Wapenstilstand op een woensdag, als "zondag" ingesteld → 27.
    expect(dagtypeVanDag('2026-11-11', '', kalender)).toEqual({ code: '27', bron: 'kalender' });
    expect(dagtypeVanDag('2026-10-17', '', kalender).code).toBe('26');
  });

  it('juli-augustus, examen en feestdag op trefwoord in de naam', () => {
    const k = kalenderUitDekking({ __weekdagen__: ['feestdag', 'juli en augustus', 'examenperiode', 'Schooldag', 'x', 'y', 'zaterdag'] });
    expect(dagtypeVanDag('2026-10-12', '', k).code).toBe('41');
    expect(dagtypeVanDag('2026-10-13', '', k).code).toBe('52');
    expect(dagtypeVanDag('2026-10-14', '', k).code).toBe('23');
    expect(dagtypeVanDag('2026-10-15', '', k).code).toBe('24');
    expect(dagtypeVanDag('2026-10-18', '', k).code).toBe('28');
  });

  it('kent de gangbare namen van vakanties: verlof, kerst, paas, krokus, herfst, en zomer = juli-augustus', () => {
    const naam = (n: string) => dagtypeVanDag('2026-10-14', n, null).code;
    expect(naam('herfstverlof')).toBe('33');
    expect(naam('Kerstvakantie')).toBe('33');
    expect(naam('paasverlof')).toBe('33');
    expect(naam('krokus')).toBe('33');
    expect(naam('zomervakantie')).toBe('43');
    expect(naam('grote vakantie')).toBe('33');
    expect(naam('schooldag dinsdag')).toBe('23');
  });

  it('een onleesbare datum geeft geen code', () => {
    expect(dagtypeVanDag('14/10/2026', '', kalender)).toEqual({ code: null, bron: 'geen' });
    expect(dagtypeVanDag('2026-02-30', '', kalender)).toEqual({ code: null, bron: 'geen' });
  });
});

const eek6 = {
  serviceNumber: 'EEK6', startTime: '07:10', endTime: '08:40', startTime2: '15:20', endTime2: '16:50', loopnr: '',
  varianten: [{ dagtypes: ['23'], startTime: '07:10', endTime: '08:40', startTime2: '11:50', endTime2: '13:20' }],
};

describe('tijdenOpDag', () => {
  it('kiest de variant van het dagtype, anders de gewone tijden', () => {
    expect(tijdenOpDag(eek6, '23')).toEqual({ startTime: '07:10', endTime: '08:40', startTime2: '11:50', endTime2: '13:20' });
    expect(tijdenOpDag(eek6, '21')).toEqual({ startTime: '07:10', endTime: '08:40', startTime2: '15:20', endTime2: '16:50' });
    expect(tijdenOpDag(eek6, null)).toEqual(tijdenOpDag(eek6, '21'));
    expect(tijdenOpDag({ startTime: '06:00', endTime: '14:00' }, '23')).toEqual({ startTime: '06:00', endTime: '14:00' });
  });

  it('een variant is een volledige set: wat erin ontbreekt is leeg, niet "zoals gewoon"', () => {
    const d = { startTime: '06:00', endTime: '14:00', startTime2: '15:00', endTime2: '18:00', varianten: [{ dagtypes: ['23'], startTime: '06:00', endTime: '12:00' }] };
    expect(tijdenOpDag(d, '23')).toEqual({ startTime: '06:00', endTime: '12:00' });
    expect(variantVoor(d, '24')).toBeNull();
  });
});

describe('variantenSchoon', () => {
  it('houdt alleen bekende codes, elk in hoogstens één variant, en laat lege varianten vallen', () => {
    expect(variantenSchoon([
      { dagtypes: ['23', '99', ' 23 ', 23], startTime: ' 07:00 ', endTime: '08:00', loopnr: '' },
      { dagtypes: ['23', '24'], startTime: '09:00', endTime: '10:00' },
      { dagtypes: ['x'], startTime: '09:00', endTime: '10:00' },
      null, 'tekst',
    ])).toEqual([
      { dagtypes: ['23'], startTime: '07:00', endTime: '08:00' },
      { dagtypes: ['24'], startTime: '09:00', endTime: '10:00' },
    ]);
  });

  it('geeft undefined zonder bruikbare varianten', () => {
    expect(variantenSchoon(undefined)).toBeUndefined();
    expect(variantenSchoon(null)).toBeUndefined();
    expect(variantenSchoon([])).toBeUndefined();
    expect(variantenSchoon([{ dagtypes: [] }])).toBeUndefined();
    expect(variantenSchoon('[]')).toBeUndefined();
  });

  it('een variant zonder één volledig deel is geen afwijking en valt weg (de code blijft vrij voor een volgende)', () => {
    expect(variantenSchoon([{ dagtypes: ['23'] }, { dagtypes: ['23'], startTime: '07:00' }])).toBeUndefined();
    expect(variantenSchoon([{ dagtypes: ['23'], startTime: '07:00' }, { dagtypes: ['23'], startTime2: '12:00', endTime2: '13:00' }]))
      .toEqual([{ dagtypes: ['23'], startTime2: '12:00', endTime2: '13:00' }]);
  });
});

describe('variantenAfdruk en tekst', () => {
  it('is onafhankelijk van de volgorde en leeg zonder varianten', () => {
    const a = variantenAfdruk([{ dagtypes: ['24', '23'], startTime: '07:00', endTime: '08:00' }, { dagtypes: ['31'], startTime: '08:00', endTime: '09:00' }]);
    const b = variantenAfdruk([{ dagtypes: ['31'], startTime: '08:00', endTime: '09:00' }, { dagtypes: ['23', '24'], startTime: '07:00 ', endTime: '08:00' }]);
    expect(a).toBe(b);
    expect(a).toBe('23,24:07:00|08:00|||||||;31:08:00|09:00|||||||');
    expect(variantenAfdruk(undefined)).toBe('');
    expect(variantenAfdruk([{ dagtypes: ['23'], startTime: '07:00', endTime: '08:00' }])).not.toBe(variantenAfdruk([{ dagtypes: ['23'], startTime: '07:00', endTime: '08:30' }]));
  });

  it('leesbaar: label van het dagtype en de delen met loop', () => {
    expect(delenTekst({ startTime: '07:10', endTime: '08:40', startTime2: '12:05', endTime2: '13:10', loopnr2: '4612' })).toBe('07:10–08:40, 12:05–13:10 (loop 4612)');
    expect(variantTekst({ dagtypes: ['23'], startTime: '07:10', endTime: '08:40' })).toBe('Woensdag schooldag: 07:10–08:40');
    expect(variantTekst({ dagtypes: ['31', '32'] })).toBe('Maandag schoolvakantie, Dinsdag schoolvakantie: geen tijden');
  });
});

describe('korte vormen voor het scherm', () => {
  it('groepeert de lijst per periode in de volgorde van de keuzelijst', () => {
    expect(DAGTYPE_GROEPEN.map((g) => `${g.groep}: ${g.dagtypes.map((d) => d.code).join(',')}`)).toEqual([
      'Schooldag: 21,22,23,24,25', 'Schoolvakantie: 31,32,33,34,35', 'Juli en augustus: 41,42,43,44,45', 'Examen: 51,52,53,54,55', 'Weekend en feestdag: 26,27,28',
    ]);
  });

  it('dagtypeKort, dagtypePeriode en dagtypesKort', () => {
    expect(['21', '23', '35', '44', '26', '27', '28', '99'].map(dagtypeKort)).toEqual(['ma', 'wo', 'vr', 'do', 'za', 'zo', 'feest', '99']);
    expect(['23', '33', '43', '53', '26', '27', '28', 'x'].map(dagtypePeriode)).toEqual(['schooldag', 'schoolvakantie', 'juli-augustus', 'examen', 'zaterdag', 'zondag', 'feestdag', '']);
    expect(dagtypesKort(['23'])).toBe('wo');
    expect(dagtypesKort(['24', '23'])).toBe('wo, do');
    expect(dagtypesKort(['31', '32', '23'])).toBe('wo · vakantie ma, di');
    expect(dagtypesKort(['55', '28', '26'])).toBe('examen vr · za, feest');
    expect(dagtypesKort([])).toBe('');
  });
});
