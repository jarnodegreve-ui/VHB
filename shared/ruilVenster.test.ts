import { describe, expect, it } from 'vitest';
import { archiefVolgorde, ruilInVenster, ruilVensterGrens } from './ruilVenster';

describe('ruilVensterGrens', () => {
  it('de eerste dag van de maand, drie maanden vóór de huidige', () => {
    expect(ruilVensterGrens('2026-10-15')).toBe('2026-07-01');
    expect(ruilVensterGrens('2026-10-01')).toBe('2026-07-01');
    expect(ruilVensterGrens('2026-10-31')).toBe('2026-07-01');
  });

  it('over de jaargrens', () => {
    expect(ruilVensterGrens('2027-01-03')).toBe('2026-10-01');
    expect(ruilVensterGrens('2027-03-31')).toBe('2026-12-01');
    expect(ruilVensterGrens('2027-04-01')).toBe('2027-01-01');
  });

  it('een ander aantal maanden', () => {
    expect(ruilVensterGrens('2026-10-15', 0)).toBe('2026-10-01');
    expect(ruilVensterGrens('2026-10-15', 12)).toBe('2025-10-01');
  });
});

describe('ruilInVenster', () => {
  const grens = '2026-07-01';

  it('wat open staat, hoe oud ook', () => {
    for (const status of ['pending', 'accepted', 'approved']) {
      expect(ruilInVenster({ status, createdAt: '2025-01-01T08:00:00Z' }, grens)).toBe(true);
    }
  });

  it('afgehandeld: aangemaakt, dienst of tegenprestatie op of na de grens', () => {
    expect(ruilInVenster({ status: 'rejected', createdAt: '2026-07-01T00:00:00Z' }, grens)).toBe(true);
    expect(ruilInVenster({ status: 'completed', createdAt: '2026-01-01T08:00:00Z', shiftDate: '2026-07-01' }, grens)).toBe(true);
    expect(ruilInVenster({ status: 'completed', createdAt: '2026-01-01T08:00:00Z', shiftDate: '2026-02-01', returnDate: '2026-08-01' }, grens)).toBe(true);
  });

  it('afgehandeld en alles vóór de grens: archief', () => {
    expect(ruilInVenster({ status: 'rejected', createdAt: '2026-06-30T23:59:59Z', shiftDate: '2026-06-30' }, grens)).toBe(false);
    expect(ruilInVenster({ status: 'cancelled', createdAt: '2026-01-01T08:00:00Z', shiftDate: null, returnDate: null }, grens)).toBe(false);
    expect(ruilInVenster({ status: 'cancelled' }, grens)).toBe(false);
  });
});

describe('archiefVolgorde', () => {
  it('het jongste beslismoment eerst, zonder beslismoment achteraan, dan aanmaakmoment en id', () => {
    const ruilen = [
      { id: 'a', status: 'rejected', decidedAt: '2026-01-02T08:00:00Z', createdAt: '2026-01-01T08:00:00Z' },
      { id: 'b', status: 'cancelled', createdAt: '2026-03-01T08:00:00Z' },
      { id: 'c', status: 'completed', decidedAt: '2026-02-02T08:00:00Z', createdAt: '2026-02-01T08:00:00Z' },
      { id: 'd', status: 'cancelled', createdAt: '2026-03-01T08:00:00Z' },
      { id: 'e', status: 'rejected', decidedAt: '2026-02-02T08:00:00Z', createdAt: '2026-01-15T08:00:00Z' },
    ];
    expect([...ruilen].sort(archiefVolgorde).map((r) => r.id)).toEqual(['c', 'e', 'a', 'd', 'b']);
  });
});
