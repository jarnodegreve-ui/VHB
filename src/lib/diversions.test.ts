import { describe, expect, it } from 'vitest';
import { omleidingsFase, omleidingsPeriode, sorteerOmleidingen } from './diversions';

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
