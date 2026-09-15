import { describe, expect, it } from 'vitest';
import { adviesSleutel, vulVervangersVoor, type BatchAdvies } from './herverdeel';

type Gat = { id: string; date: string; code: string };
const advies = (date: string, code: string, ids: string[]): BatchAdvies => ({
  date, code, passend: ids.map((id) => ({ id, name: `Chauffeur ${id}` })),
});

describe('vulVervangersVoor', () => {
  const per: Record<string, BatchAdvies> = {
    [adviesSleutel('2026-09-15', '2101')]: advies('2026-09-15', '2101', ['a', 'b', 'c']),
    [adviesSleutel('2026-09-15', '2607')]: advies('2026-09-15', '2607', ['a', 'c']),
    [adviesSleutel('2026-09-16', '2101')]: advies('2026-09-16', '2101', ['a']),
  };
  const gaten: Gat[] = [
    { id: 'g1', date: '2026-09-15', code: '2101' },
    { id: 'g2', date: '2026-09-15', code: '2607' },
    { id: 'g3', date: '2026-09-16', code: '2101' },
  ];
  const opties = (huidig: Record<string, string>) => ({
    sleutelVan: (g: Gat) => g.id,
    dagVan: (g: Gat) => g.date,
    adviesVan: (g: Gat) => per[adviesSleutel(g.date, g.code)],
    huidig,
  });

  it('geeft twee gaten op dezelfde dag niet dezelfde topkandidaat, een andere dag wel', () => {
    const next = vulVervangersVoor(gaten, opties({}));
    expect(next).toEqual({ g1: 'a', g2: 'c', g3: 'a' });
  });

  it('respecteert bestaande keuzes en telt ze als bezet', () => {
    const huidig = { g1: 'c' };
    const next = vulVervangersVoor(gaten, opties(huidig));
    expect(next).toEqual({ g1: 'c', g2: 'a', g3: 'a' });
    expect(huidig).toEqual({ g1: 'c' });
  });

  it('laat een gat leeg als alle passende kandidaten die dag al bezet zijn', () => {
    // g4 heeft geen advies maar wel een handmatige keuze ('c'); samen met g1
    // ('a') is alles wat bij g2 past die dag bezet.
    const g4: Gat = { id: 'g4', date: '2026-09-15', code: '9999' };
    const next = vulVervangersVoor([gaten[0], gaten[1], g4], opties({ g1: 'a', g4: 'c' }));
    expect(next.g2).toBeUndefined();
    // Een keuze die niet aan een gat van deze lijst hangt, telt niet als bezet.
    const enkel = vulVervangersVoor([gaten[1]], opties({ los: 'a' }));
    expect(enkel.g2).toBe('a');
  });

  it('adviesSleutel normaliseert de code', () => {
    expect(adviesSleutel('2026-09-15', ' 2101 ')).toBe('2026-09-15|2101');
    expect(adviesSleutel('2026-09-15', 'BV')).toBe('2026-09-15|bv');
  });
});
