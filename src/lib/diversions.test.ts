import { describe, expect, it } from 'vitest';
import { groepeerOmleidingen, isRecentGenoeg, omleidingsFase, omleidingsPeriode, omleidingsTijdshint, sorteerOmleidingen } from './diversions';

const vandaag = '2026-09-10';

describe('omleidingsFase', () => {
  it('kent lopend, komend en verlopen', () => {
    expect(omleidingsFase({ startDate: '2026-09-01', endDate: '2026-09-20' }, vandaag)).toBe('lopend');
    expect(omleidingsFase({ startDate: '2026-09-10' }, vandaag)).toBe('lopend');
    expect(omleidingsFase({ startDate: '2026-09-11' }, vandaag)).toBe('komend');
    expect(omleidingsFase({ startDate: '2026-09-01', endDate: '2026-09-09' }, vandaag)).toBe('verlopen');
    // Laatste dag telt nog mee als lopend.
    expect(omleidingsFase({ startDate: '2026-09-01', endDate: '2026-09-10' }, vandaag)).toBe('lopend');
  });
});

describe('sorteerOmleidingen', () => {
  it('zet lopend eerst, dan komend, verlopen onderaan; chronologisch binnen de groep', () => {
    const lijst = [
      { id: 'verlopen-oud', startDate: '2026-08-01', endDate: '2026-08-15' },
      { id: 'komend-laat', startDate: '2026-10-01', endDate: '2026-10-05' },
      { id: 'lopend-nieuw', startDate: '2026-09-08', endDate: '2026-09-30' },
      { id: 'verlopen-recent', startDate: '2026-08-20', endDate: '2026-09-05' },
      { id: 'komend-vroeg', startDate: '2026-09-15' },
      { id: 'lopend-oud', startDate: '2026-09-01' },
    ];
    expect(sorteerOmleidingen(lijst, vandaag).map((d) => d.id)).toEqual([
      'lopend-oud',
      'lopend-nieuw',
      'komend-vroeg',
      'komend-laat',
      'verlopen-recent',
      'verlopen-oud',
    ]);
  });

  it('laat de invoer ongemoeid', () => {
    const lijst = [{ startDate: '2026-09-20' }, { startDate: '2026-09-01' }];
    sorteerOmleidingen(lijst, vandaag);
    expect(lijst[0].startDate).toBe('2026-09-20');
  });
});

describe('omleidingsPeriode', () => {
  it('toont begin en einde in één regel', () => {
    expect(omleidingsPeriode({ startDate: '2026-09-08', endDate: '2026-09-19' }, vandaag)).toMatch(/^\S+ 8 sep\.? t\/m \S+ 19 sep\.?$/);
  });
  it('zegt "Vanaf" zonder einddatum en toont één dag maar één keer', () => {
    expect(omleidingsPeriode({ startDate: '2026-09-08' }, vandaag)).toMatch(/^Vanaf \S+ 8 sep\.?$/);
    expect(omleidingsPeriode({ startDate: '2026-09-08', endDate: '2026-09-08' }, vandaag)).toMatch(/^\S+ 8 sep\.?$/);
  });
  it('voegt het jaartal toe als het niet dit jaar is', () => {
    expect(omleidingsPeriode({ startDate: '2026-12-20', endDate: '2027-01-10' }, vandaag)).toMatch(/dec\.? t\/m \S+ 10 jan\.? 2027$/);
  });
});

describe('omleidingsTijdshint', () => {
  it('telt af naar het einde van een lopende omleiding', () => {
    expect(omleidingsTijdshint({ startDate: '2026-09-01', endDate: '2026-09-24' }, vandaag)).toBe('nog 14 dagen');
    expect(omleidingsTijdshint({ startDate: '2026-09-01', endDate: '2026-09-11' }, vandaag)).toBe('laatste dag morgen');
    expect(omleidingsTijdshint({ startDate: '2026-09-01', endDate: '2026-09-10' }, vandaag)).toBe('laatste dag vandaag');
  });
  it('zegt wanneer een komende omleiding start', () => {
    expect(omleidingsTijdshint({ startDate: '2026-09-11' }, vandaag)).toBe('start morgen');
    expect(omleidingsTijdshint({ startDate: '2026-09-12' }, vandaag)).toBe('start overmorgen');
    expect(omleidingsTijdshint({ startDate: '2026-09-15' }, vandaag)).toBe('start over 5 dagen');
  });
  it('zwijgt zonder einddatum en na afloop', () => {
    expect(omleidingsTijdshint({ startDate: '2026-09-01' }, vandaag)).toBe('');
    expect(omleidingsTijdshint({ startDate: '2026-08-01', endDate: '2026-08-15' }, vandaag)).toBe('');
  });
});

describe('isRecentGenoeg en groepeerOmleidingen', () => {
  it('laat verlopen omleidingen na 30 dagen uit de chauffeurslijst vallen', () => {
    expect(isRecentGenoeg({ startDate: '2026-08-01', endDate: '2026-08-11' }, vandaag)).toBe(true);
    expect(isRecentGenoeg({ startDate: '2026-08-01', endDate: '2026-08-10' }, vandaag)).toBe(false);
    expect(isRecentGenoeg({ startDate: '2026-01-01' }, vandaag)).toBe(true);
  });
  it('verdeelt gesorteerd in lopend, komend en verlopen', () => {
    const g = groepeerOmleidingen([
      { id: 'v', startDate: '2026-08-01', endDate: '2026-09-01' },
      { id: 'k', startDate: '2026-09-20' },
      { id: 'l2', startDate: '2026-09-05' },
      { id: 'l1', startDate: '2026-09-01' },
    ], vandaag);
    expect(g.lopend.map((d) => d.id)).toEqual(['l1', 'l2']);
    expect(g.komend.map((d) => d.id)).toEqual(['k']);
    expect(g.verlopen.map((d) => d.id)).toEqual(['v']);
  });
});
