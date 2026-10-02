import { describe, expect, it } from 'vitest';
import { uitersteVerlofdag, verlofGrensFout, verlofGrensMelding } from './verlofGrens';

/** Regel Jarno 02-10: verlof eindigt uiterlijk op 31 december van het jaar na het lopende (Brusselse) jaar. */
describe('uiterste einddatum van verlof', () => {
  it('31 december van volgend jaar, het hele jaar door', () => {
    expect(uitersteVerlofdag('2026-01-01')).toBe('2027-12-31');
    expect(uitersteVerlofdag('2026-10-02')).toBe('2027-12-31');
    expect(uitersteVerlofdag('2026-12-31')).toBe('2027-12-31');
    expect(uitersteVerlofdag('2027-01-01')).toBe('2028-12-31');
    expect(uitersteVerlofdag('2099-06-15')).toBe('2100-12-31');
  });

  it('de tekst noemt de dag als dd/mm/jjjj, zonder ISO-datum', () => {
    expect(verlofGrensMelding('2026-10-02')).toBe('Verlof aanvragen kan tot en met 31/12/2027.');
    expect(verlofGrensMelding('2027-01-01')).toBe('Verlof aanvragen kan tot en met 31/12/2028.');
  });

  it('tot en met de grens is er geen fout, de dag erna wel; een verre of onbestaande datum ook', () => {
    expect(verlofGrensFout('2026-10-02', '2026-10-02')).toBeNull();
    expect(verlofGrensFout('2027-12-31', '2026-10-02')).toBeNull();
    expect(verlofGrensFout('2028-01-01', '2026-10-02')).toBe('Verlof aanvragen kan tot en met 31/12/2027.');
    expect(verlofGrensFout('9999-12-31', '2026-10-02')).toBe('Verlof aanvragen kan tot en met 31/12/2027.');
    expect(verlofGrensFout('9999-99-99', '2026-10-02')).toBe('Verlof aanvragen kan tot en met 31/12/2027.');
    // Een einde in het verleden is hier geen fout: dat is een andere regel.
    expect(verlofGrensFout('2020-01-01', '2026-10-02')).toBeNull();
  });

  it('de server (brusselsDay) en het scherm (vandaagBrussel) geven dezelfde dag, ook rond de jaarwissel', async () => {
    const { brusselsDay } = await import('../api/helpers');
    const { vandaagBrussel } = await import('../src/lib/brussel');
    for (const moment of ['2026-12-31T22:30:00Z', '2026-12-31T23:30:00Z', '2027-01-01T00:30:00Z', '2027-06-30T22:01:00Z']) {
      const nu = new Date(moment);
      expect(brusselsDay(nu.toISOString()), moment).toBe(vandaagBrussel(nu));
      expect(uitersteVerlofdag(vandaagBrussel(nu)), moment).toBe(uitersteVerlofdag(brusselsDay(nu.toISOString())));
    }
    // 23:30 UTC op oudejaar is in Brussel al nieuwjaar: de grens schuift een jaar op.
    expect(uitersteVerlofdag(vandaagBrussel(new Date('2026-12-31T22:30:00Z')))).toBe('2027-12-31');
    expect(uitersteVerlofdag(vandaagBrussel(new Date('2026-12-31T23:30:00Z')))).toBe('2028-12-31');
  });
});
