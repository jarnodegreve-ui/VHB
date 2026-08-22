import { describe, it, expect } from 'vitest';
import { normalizeCode, computeDayGap, resolveDayType, resolveDayTypeMetBron, vergelijkVerwachtingenMetPraktijk, stelVerwachtingenVoor, parseOverrides, encodeOverride, periodeVoorDatum, weekdaysVoorDatum, encodeWeekdagPeriodeKey, WEEKDAY_PERIOD_KEY_RE, DEFAULT_WEEKDAYS } from './coverageGaps';

describe('coverageGaps', () => {
  it('normalizeCode trimt + lowercase', () => {
    expect(normalizeCode('  4101 ')).toBe('4101');
    expect(normalizeCode('GAR')).toBe('gar');
    expect(normalizeCode(null)).toBe('');
  });

  it('computeDayGap: ontbrekende verwachte diensten', () => {
    const gap = computeDayGap(
      '2026-07-03',
      'weekdag',
      ['2111', '2112', '5104', '4101'],
      ['2111', 'bv', '4101', 'GAR'], // 2112 en 5104 ontbreken
    );
    expect(gap.expected).toBe(4);
    expect(gap.covered).toBe(2);
    expect(gap.missing).toEqual(['2112', '5104']);
  });

  it('computeDayGap: alles gedekt → geen gaten', () => {
    const gap = computeDayGap('2026-07-04', 'zaterdag', ['7001', '7002'], ['7002', '7001', 'V']);
    expect(gap.missing).toEqual([]);
    expect(gap.covered).toBe(2);
  });

  it('computeDayGap: geen verwachtingen ingesteld → niets ontbreekt', () => {
    const gap = computeDayGap('2026-07-05', 'zondag', [], ['9001']);
    expect(gap.expected).toBe(0);
    expect(gap.missing).toEqual([]);
  });

  it('computeDayGap: hoofdletter-ongevoelig', () => {
    const gap = computeDayGap('2026-07-06', 'weekdag', ['ABC1'], ['abc1']);
    expect(gap.missing).toEqual([]);
  });

  it('computeDayGap: dubbele verwachte code telt maar één keer', () => {
    const gap = computeDayGap('2026-07-07', 'weekdag', ['4101', '4101', '4102'], ['4102']);
    expect(gap.expected).toBe(2);
    expect(gap.covered).toBe(1);
    expect(gap.missing).toEqual(['4101']);
  });

  it('computeDayGap: lege/whitespace verwachte entries worden genegeerd', () => {
    const gap = computeDayGap('2026-07-08', 'weekdag', ['', '  ', '4101'], []);
    expect(gap.expected).toBe(1);
    expect(gap.missing).toEqual(['4101']);
  });

  it('resolveDayType: expliciet dag-type (import-kopje) wint altijd', () => {
    expect(resolveDayType('feestdag', '2026-06-13', DEFAULT_WEEKDAYS)).toBe('feestdag');
    expect(resolveDayType('  Marktdag ', '2026-06-14', DEFAULT_WEEKDAYS)).toBe('Marktdag');
  });

  it('resolveDayType: leeg dag-type → standaard dag-type voor die weekdag', () => {
    // DEFAULT_WEEKDAYS: zo=zondag, ma–vr=schooldag, za=zaterdag.
    expect(resolveDayType('', '2026-06-08', DEFAULT_WEEKDAYS)).toBe('schooldag'); // maandag
    expect(resolveDayType('   ', '2026-06-12', DEFAULT_WEEKDAYS)).toBe('schooldag'); // vrijdag
    expect(resolveDayType('', '2026-06-13', DEFAULT_WEEKDAYS)).toBe('zaterdag');
    expect(resolveDayType(null, '2026-06-14', DEFAULT_WEEKDAYS)).toBe('zondag');
  });

  it('resolveDayType: een uitzondering wint van de weekdag-standaard', () => {
    const overrides = parseOverrides(['2026-07-01..2026-08-31|vakantie']);
    expect(resolveDayType('', '2026-07-06', DEFAULT_WEEKDAYS, overrides)).toBe('vakantie'); // maandag in vakantie
    expect(resolveDayType('', '2026-06-08', DEFAULT_WEEKDAYS, overrides)).toBe('schooldag'); // buiten de periode
    // Een uitzondering geldt voor álle dagen in de range, ook het weekend.
    expect(resolveDayType('', '2026-07-11', DEFAULT_WEEKDAYS, overrides)).toBe('vakantie'); // zaterdag in vakantie
  });

  it('resolveDayType: aangepaste weekdag-toewijzing wordt gerespecteerd', () => {
    const weekdays = ['zon', 'werkdag', 'werkdag', 'werkdag', 'werkdag', 'werkdag', 'zat'];
    expect(resolveDayType('', '2026-06-08', weekdays)).toBe('werkdag'); // maandag
    expect(resolveDayType('', '2026-06-14', weekdays)).toBe('zon'); // zondag
    // Geen toewijzing voor die weekdag → leeg.
    expect(resolveDayType('', '2026-06-08', ['', '', '', '', '', '', ''])).toBe('');
  });

  it('resolveDayType: ongeldige datum zonder dag-type → leeg', () => {
    expect(resolveDayType('', 'geen-datum', DEFAULT_WEEKDAYS)).toBe('');
    expect(resolveDayType(undefined, '', DEFAULT_WEEKDAYS)).toBe('');
  });

  it('parseOverrides/encodeOverride: round-trip + rommel negeren + omgekeerde range rechtzetten', () => {
    expect(parseOverrides(['2026-07-01..2026-08-31|vakantie'])).toEqual([{ from: '2026-07-01', to: '2026-08-31', dayType: 'vakantie' }]);
    expect(parseOverrides(['2026-08-31..2026-07-01|vakantie'])).toEqual([{ from: '2026-07-01', to: '2026-08-31', dayType: 'vakantie' }]);
    expect(parseOverrides(['geen-pipe', '2026-07-01..x|y', '2026-07-01..2026-07-01|', null])).toEqual([]);
    expect(parseOverrides('geen-array' as unknown)).toEqual([]);
    expect(encodeOverride({ from: '2026-08-31', to: '2026-07-01', dayType: 'feestdag' })).toBe('2026-07-01..2026-08-31|feestdag');
  });

  it('weekdaysVoorDatum: recentste ingangsdatum ≤ datum wint, anders de basis', () => {
    const basis = ['b', 'b', 'b', 'b', 'b', 'b', 'b'];
    const zomer = { vanaf: '2026-07-01', weekdays: ['z', 'z', 'z', 'z', 'z', 'z', 'z'] };
    const school = { vanaf: '2026-09-01', weekdays: ['s', 's', 's', 's', 's', 's', 's'] };
    // Vóór elke periode: basis; binnen een periode: die periode; bij twee
    // gepasseerde ingangsdatums wint de recentste — volgorde in de lijst
    // maakt niet uit.
    expect(weekdaysVoorDatum(basis, [school, zomer], '2026-06-30')).toBe(basis);
    expect(weekdaysVoorDatum(basis, [school, zomer], '2026-07-01')).toBe(zomer.weekdays);
    expect(weekdaysVoorDatum(basis, [school, zomer], '2026-08-31')).toBe(zomer.weekdays);
    expect(weekdaysVoorDatum(basis, [school, zomer], '2026-09-01')).toBe(school.weekdays);
    // Een kapotte periode (geen 7 entries) telt niet mee.
    expect(weekdaysVoorDatum(basis, [{ vanaf: '2026-01-01', weekdays: ['x'] }], '2026-06-01')).toBe(basis);
  });

  it('weekdag-periode-sleutels: encode/parse zijn elkaars spiegel', () => {
    expect(encodeWeekdagPeriodeKey('2026-09-01')).toBe('__weekdagen_2026-09-01__');
    expect(WEEKDAY_PERIOD_KEY_RE.exec('__weekdagen_2026-09-01__')?.[1]).toBe('2026-09-01');
    // De basis-sleutel en andere reserved keys matchen niet.
    expect(WEEKDAY_PERIOD_KEY_RE.test('__weekdagen__')).toBe(false);
    expect(WEEKDAY_PERIOD_KEY_RE.test('__uitzonderingen__')).toBe(false);
  });
});

describe('resolveDayTypeMetBron', () => {
  const basis = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

  it('volgt dezelfde beslisregels als resolveDayType, mét herkomst', () => {
    // Expliciet dag-type uit de Excel wint altijd.
    expect(resolveDayTypeMetBron('W', '2026-09-01', basis, [], [])).toEqual({ dayType: 'W', bron: { soort: 'excel' } });
    // Uitzondering gaat vóór de weekdag-toewijzing.
    const uitz = [{ from: '2026-09-01', to: '2026-09-02', dayType: 'feestdag' }];
    expect(resolveDayTypeMetBron('', '2026-09-01', basis, [], uitz)).toEqual({
      dayType: 'feestdag',
      bron: { soort: 'uitzondering', from: '2026-09-01', to: '2026-09-02' },
    });
    // Zonder periode: basis (2026-09-01 is een dinsdag).
    expect(resolveDayTypeMetBron('', '2026-09-01', basis, [], [])).toEqual({ dayType: 'di', bron: { soort: 'basis' } });
    // Mét gepasseerde periode: die wint, en de ingangsdatum reist mee.
    const periode = [{ vanaf: '2026-09-01', weekdays: ['zo2', 'ma2', 'di2', 'wo2', 'do2', 'vr2', 'za2'] }];
    expect(resolveDayTypeMetBron('', '2026-09-01', basis, periode, [])).toEqual({
      dayType: 'di2',
      bron: { soort: 'periode', vanaf: '2026-09-01' },
    });
    expect(resolveDayTypeMetBron('', '2026-08-31', basis, periode, [])).toEqual({ dayType: 'ma', bron: { soort: 'basis' } });
  });

  it('geeft bron "geen" bij een kapotte datum of lege toewijzing', () => {
    expect(resolveDayTypeMetBron('', 'kapot', basis, [], [])).toEqual({ dayType: '', bron: { soort: 'geen' } });
    expect(resolveDayTypeMetBron('', '2026-09-01', ['', '', '', '', '', '', ''], [], [])).toEqual({ dayType: '', bron: { soort: 'geen' } });
  });

  it('blijft gelijk aan resolveDayType voor het dag-type zelf', () => {
    const uitz = [{ from: '2026-09-07', to: '2026-09-07', dayType: 'feestdag' }];
    const periode = [{ vanaf: '2026-09-01', weekdays: ['zo2', 'ma2', 'di2', 'wo2', 'do2', 'vr2', 'za2'] }];
    for (const datum of ['2026-08-31', '2026-09-01', '2026-09-07', 'kapot']) {
      expect(resolveDayTypeMetBron('', datum, basis, periode, uitz).dayType)
        .toBe(resolveDayType('', datum, weekdaysVoorDatum(basis, periode, datum), uitz));
    }
  });
});

describe('vergelijkVerwachtingenMetPraktijk', () => {
  // Het 20-08-scenario in het klein: "schooldag di/vrij" verwacht 2114 op
  // beide dagen, maar dinsdag rijdt hem nooit en vrijdag rijdt 2515 die niet
  // in de lijst staat → fantoomgaten op de dekking.
  const rij = (date: string, dayType: string, codes: Record<string, string>) => ({
    source_date: date,
    day_type: dayType,
    assignments: codes,
  });

  it('vindt nooit-gereden verwachte diensten en structureel niet-verwachte codes', () => {
    const rows = [
      rij('2026-09-01', 'di/vrij', { A: '2101', B: '2102', C: 'vrij' }),
      rij('2026-09-04', 'di/vrij', { A: '2101', B: '2102', C: '2515' }),
      rij('2026-09-08', 'di/vrij', { A: '2101', B: '2102', C: '2515' }),
    ];
    const uit = vergelijkVerwachtingenMetPraktijk(rows, { 'di/vrij': ['2101', '2102', '2114'] }, [], [], []);
    expect(uit).toHaveLength(1);
    expect(uit[0].dayType).toBe('di/vrij');
    expect(uit[0].dagen).toBe(3);
    expect(uit[0].nooitGereden).toEqual(['2114']);
    // 2515 rijdt op 2 van de 3 dagen (≥ helft) → gemeld; 'vrij' nooit.
    expect(uit[0].nietVerwacht).toEqual([{ code: '2515', dagen: 2 }]);
  });

  it('meldt géén afwijking voor een dienst die maar af en toe openstaat', () => {
    // 2102 ontbreekt op één dag: dat is een gewoon gat (dekking-lijst), geen
    // structurele afwijking van de verwachting.
    const rows = [
      rij('2026-09-01', 'school', { A: '2101', B: '2102' }),
      rij('2026-09-02', 'school', { A: '2101' }),
    ];
    expect(vergelijkVerwachtingenMetPraktijk(rows, { school: ['2101', '2102'] }, [], [], [])).toEqual([]);
  });

  it('negeert lettercodes en incidentele cijfercodes als "niet verwacht"', () => {
    const rows = [
      rij('2026-09-01', 'school', { A: '2101', B: 'EEK5', C: 'ziek' }),
      rij('2026-09-02', 'school', { A: '2101', B: 'EEK5', C: '2599' }),
      rij('2026-09-03', 'school', { A: '2101', B: 'EEK5', C: 'bv' }),
      rij('2026-09-04', 'school', { A: '2101', B: 'EEK5', C: 'bv' }),
    ];
    // EEK5/ziek/bv zijn geen dienst-achtige codes; 2599 rijdt maar 1 van de
    // 4 dagen (< helft) — allebei geen melding.
    expect(vergelijkVerwachtingenMetPraktijk(rows, { school: ['2101'] }, [], [], [])).toEqual([]);
  });

  it('resolvet het dag-type via weekdagen/periodes als kolom B leeg is', () => {
    // 01-09 en 08-09-2026 zijn dinsdagen; de periode vanaf 01-09 wijst di
    // naar 'di-type' (twee dagen, zodat de kleine-steekproef-drempel niet
    // in de weg zit).
    const rows = [rij('2026-09-01', '', { A: '2101' }), rij('2026-09-08', '', { A: '2101' })];
    const periode = [{ vanaf: '2026-09-01', weekdays: ['', '', 'di-type', '', '', '', ''] }];
    const uit = vergelijkVerwachtingenMetPraktijk(rows, { 'di-type': ['2101', '2114'] }, ['', '', 'basis-di', '', '', '', ''], periode, []);
    expect(uit).toHaveLength(1);
    expect(uit[0].dayType).toBe('di-type');
    expect(uit[0].nooitGereden).toEqual(['2114']);
  });

  it('slaat dag-types zonder verwachtingslijst over', () => {
    const rows = [rij('2026-09-01', 'onbekend-type', { A: '2101' })];
    expect(vergelijkVerwachtingenMetPraktijk(rows, { school: ['2101'] }, [], [], [])).toEqual([]);
  });

  it('zwijgt over een dag-type met maar één dag in het venster (kleine steekproef)', () => {
    // Eén feestdag met een invaller op een andere dienst is dekking-lijst-
    // werk, geen structurele verwachtingsafwijking.
    const rows = [rij('2026-09-01', 'feestdag', { A: '2599' })];
    expect(vergelijkVerwachtingenMetPraktijk(rows, { feestdag: ['2101'] }, [], [], [])).toEqual([]);
  });
});

describe('periodeVoorDatum', () => {
  it('kiest de recentste gepasseerde periode, of null', () => {
    const zomer = { vanaf: '2026-07-01', weekdays: ['z', 'z', 'z', 'z', 'z', 'z', 'z'] };
    const school = { vanaf: '2026-09-01', weekdays: ['s', 's', 's', 's', 's', 's', 's'] };
    expect(periodeVoorDatum([school, zomer], '2026-06-30')).toBeNull();
    expect(periodeVoorDatum([school, zomer], '2026-08-31')).toBe(zomer);
    expect(periodeVoorDatum([school, zomer], '2026-09-01')).toBe(school);
    // Kapotte periode (geen 7 entries) telt niet mee.
    expect(periodeVoorDatum([{ vanaf: '2026-01-01', weekdays: ['x'] }], '2026-06-01')).toBeNull();
  });
});

describe('stelVerwachtingenVoor', () => {
  const rij = (date: string, dayType: string, codes: Record<string, string>) => ({
    source_date: date,
    day_type: dayType,
    assignments: codes,
  });

  it('stelt per dag-type de codes voor die op minstens de helft van de dagen rijden', () => {
    const rows = [
      rij('2026-09-01', 'di', { A: '2101', B: '2115', C: 'vrij' }),
      rij('2026-09-08', 'di', { A: '2101', B: '2115', C: '2214' }),
      rij('2026-09-15', 'di', { A: '2101', B: 'ziek', C: '2214' }),
    ];
    const uit = stelVerwachtingenVoor(rows, [], [], []);
    expect(uit).toEqual([
      {
        dayType: 'di',
        dagen: 3,
        codes: [
          { code: '2101', dagen: 3 },
          { code: '2115', dagen: 2 },
          { code: '2214', dagen: 2 },
        ],
      },
    ]);
  });

  it('negeert lettercodes, dubbele cellen en dag-types met maar één dag', () => {
    const rows = [
      rij('2026-09-02', 'wo', { A: '2301', B: 'EEK5', C: '2301' }),
      rij('2026-09-05', 'za', { A: '2601' }),
      rij('2026-09-09', 'wo', { A: '2301', B: 'EEK5', C: 'bv' }),
    ];
    const uit = stelVerwachtingenVoor(rows, [], [], []);
    // za heeft één dag → geen voorstel; EEK5/bv zijn geen cijfercodes;
    // de dubbele 2301 op 02-09 telt die dag één keer.
    expect(uit).toEqual([
      { dayType: 'wo', dagen: 2, codes: [{ code: '2301', dagen: 2 }] },
    ]);
  });

  it('resolvet het dag-type via weekdagen/periodes als kolom B leeg is', () => {
    const periode = [{ vanaf: '2026-09-01', weekdays: ['', '', 'di-type', '', '', '', ''] }];
    const rows = [
      rij('2026-09-01', '', { A: '2101' }),
      rij('2026-09-08', '', { A: '2101' }),
    ];
    const uit = stelVerwachtingenVoor(rows, [], periode, []);
    expect(uit).toEqual([{ dayType: 'di-type', dagen: 2, codes: [{ code: '2101', dagen: 2 }] }]);
  });
});
