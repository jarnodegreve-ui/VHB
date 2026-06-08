import { describe, it, expect } from 'vitest';
import { conflictIds, isoDate, addDays, mondayOf, type AvailabilityDay } from './availability';

describe('availability — helpers', () => {
  it('conflictIds: drivers die rijden én verlof hebben', () => {
    const day: AvailabilityDay = {
      date: '2026-07-06',
      working: ['a', 'b', 'c'],
      leave: ['b', 'd'],
      free: ['e'],
    };
    expect(conflictIds(day)).toEqual(['b']);
  });

  it('conflictIds: geen overlap → leeg', () => {
    const day: AvailabilityDay = { date: '2026-07-06', working: ['a'], leave: ['b'], free: [] };
    expect(conflictIds(day)).toEqual([]);
  });

  it('isoDate formatteert lokaal yyyy-mm-dd', () => {
    expect(isoDate(new Date(2026, 6, 6))).toBe('2026-07-06'); // maand is 0-indexed → juli
    expect(isoDate(new Date(2026, 0, 1))).toBe('2026-01-01');
  });

  it('addDays telt dagen op (incl. maandgrens)', () => {
    expect(isoDate(addDays(new Date(2026, 6, 6), 6))).toBe('2026-07-12');
    expect(isoDate(addDays(new Date(2026, 6, 30), 3))).toBe('2026-08-02');
  });

  it('mondayOf geeft de maandag van de week', () => {
    // 2026-07-08 is een woensdag → maandag = 2026-07-06
    expect(isoDate(mondayOf(new Date(2026, 6, 8)))).toBe('2026-07-06');
    // zondag 2026-07-12 → maandag = 2026-07-06
    expect(isoDate(mondayOf(new Date(2026, 6, 12)))).toBe('2026-07-06');
    // maandag blijft maandag
    expect(isoDate(mondayOf(new Date(2026, 6, 6)))).toBe('2026-07-06');
  });
});
