import { describe, expect, it } from 'vitest';
import { addDagen, maandPlus, relatieveDag } from './datum';

describe('datum-helpers', () => {
  it('addDagen loopt over maand- en jaargrenzen heen', () => {
    expect(addDagen('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDagen('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDagen('2026-08-04', 366)).toBe('2027-08-05');
  });

  it('relatieveDag spreekt in dag-taal, over maandgrenzen en zomertijd heen', () => {
    expect(relatieveDag('2026-09-06', '2026-09-06')).toBe('vandaag');
    expect(relatieveDag('2026-09-05', '2026-09-06')).toBe('vandaag'); // verleden = vandaag (dienst loopt nog)
    expect(relatieveDag('2026-09-07', '2026-09-06')).toBe('morgen');
    expect(relatieveDag('2026-09-08', '2026-09-06')).toBe('overmorgen');
    expect(relatieveDag('2026-10-01', '2026-09-28')).toBe('over 3 dagen');
    expect(relatieveDag('2026-10-26', '2026-10-24')).toBe('overmorgen'); // over de klokwissel van 25-10
  });

  it('maandPlus loopt over jaargrenzen heen', () => {
    expect(maandPlus('2026-01', -1)).toBe('2025-12');
    expect(maandPlus('2026-12', 1)).toBe('2027-01');
    expect(maandPlus('2026-08', 0)).toBe('2026-08');
  });
});
