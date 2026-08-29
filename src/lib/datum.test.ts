import { describe, expect, it } from 'vitest';
import { addDagen, maandPlus } from './datum';

describe('datum-helpers', () => {
  it('addDagen loopt over maand- en jaargrenzen heen', () => {
    expect(addDagen('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDagen('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDagen('2026-08-04', 366)).toBe('2027-08-05');
  });

  it('maandPlus loopt over jaargrenzen heen', () => {
    expect(maandPlus('2026-01', -1)).toBe('2025-12');
    expect(maandPlus('2026-12', 1)).toBe('2027-01');
    expect(maandPlus('2026-08', 0)).toBe('2026-08');
  });
});
