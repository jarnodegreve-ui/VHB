import { describe, it, expect } from 'vitest';
import { normalizeCode, computeDayGap, resolveDayType, parseOverrides, encodeOverride, DEFAULT_WEEKDAYS } from './coverageGaps';

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
});
