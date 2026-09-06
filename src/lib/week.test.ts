import { describe, it, expect } from 'vitest';
import { isoWeekNumber, isoWeekOf, weekRangeLabel } from './week';

describe('week, ISO-weeknummers', () => {
  it('week 1 bevat 4 januari', () => {
    expect(isoWeekNumber(new Date(2026, 0, 4))).toBe(1);
    expect(isoWeekNumber(new Date(2026, 0, 1))).toBe(1); // do 1 jan 2026 → week 1
  });

  it('isoWeekOf werkt op een yyyy-mm-dd-string', () => {
    // maandag 13 juli 2026 = week 29
    expect(isoWeekOf('2026-07-13')).toBe(29);
    expect(isoWeekOf('2026-07-19')).toBe(29); // zondag zelfde week
    expect(isoWeekOf('2026-07-20')).toBe(30); // maandag erna
  });

  it('weekRangeLabel: één week vs. een spanning', () => {
    expect(weekRangeLabel(['2026-07-13', '2026-07-19'])).toBe('wk 29');
    expect(weekRangeLabel(['2026-07-13', '2026-07-26'])).toBe('wk 29–30');
    expect(weekRangeLabel([])).toBe('');
  });

  it('weekRangeLabel: over de jaargrens chronologisch (wk 53–1, niet wk 1–53)', () => {
    // 28 dec 2026 (ma) = ISO-wk 53, 4 jan 2027 (ma) = ISO-wk 1
    expect(weekRangeLabel(['2026-12-28', '2027-01-04'])).toBe('wk 53–1');
    // ongesorteerde input levert nog steeds chronologisch op
    expect(weekRangeLabel(['2027-01-04', '2026-12-28'])).toBe('wk 53–1');
  });
});
