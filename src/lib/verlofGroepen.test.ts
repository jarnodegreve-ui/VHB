import { describe, expect, it } from 'vitest';
import type { LeaveRequest } from '../types';
import { groepeerPerJaar, jaarVan } from './verlofGroepen';

const r = (id: string, startDate: string, endDate = startDate): LeaveRequest => ({
  id,
  userId: '3',
  type: 'betaald_verlof',
  status: 'approved',
  startDate,
  endDate,
  createdAt: `${startDate}T08:00:00.000Z`,
} as LeaveRequest);

describe('groepeerPerJaar', () => {
  it('groepeert op het jaar van de startdatum en houdt de aangeleverde volgorde aan', () => {
    const groepen = groepeerPerJaar([r('a', '2026-08-10'), r('b', '2026-02-02'), r('c', '2025-11-03')]);
    expect(groepen.map((g) => [g.jaar, g.items.map((i) => i.id)])).toEqual([
      ['2026', ['a', 'b']],
      ['2025', ['c']],
    ]);
  });

  it('een verlof over de jaargrens hoort bij het jaar waarin het begon', () => {
    expect(jaarVan(r('a', '2026-12-28', '2027-01-03'))).toBe('2026');
  });

  it('een lege lijst geeft geen groepen; een ontbrekende datum valt op Onbekend', () => {
    expect(groepeerPerJaar([])).toEqual([]);
    expect(groepeerPerJaar([r('a', '')])[0].jaar).toBe('Onbekend');
  });
});
