import { describe, it, expect } from 'vitest';
import { normalizeCode, computeDayGap } from './coverageGaps';

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
});
