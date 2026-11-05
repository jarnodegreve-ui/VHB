import { describe, expect, it } from 'vitest';
import { BEZETTING_LABEL, bezettingVanDag } from './verlofBezetting';

describe('bezettingVanDag (verlofkalender)', () => {
  it('vrij, deels vrij en volzet tegenover de limiet van de dag', () => {
    expect(bezettingVanDag(0, 2)).toBe('vrij');
    expect(bezettingVanDag(1, 2)).toBe('deels');
    expect(bezettingVanDag(2, 2)).toBe('volzet');
    expect(bezettingVanDag(3, 2)).toBe('volzet');
  });
  it('limiet 0 (feestdag, zondag in de kalender 2027) is "geen verlof mogelijk", niet vrij en niet volzet', () => {
    expect(bezettingVanDag(0, 0)).toBe('geen');
    // De limiet gaat vóór de telling: een al geregistreerde afwezigheid maakt er geen "volzet" van.
    expect(bezettingVanDag(1, 0)).toBe('geen');
    expect(bezettingVanDag(0, -1)).toBe('geen');
  });
  it('elke staat heeft een tekst, zodat de cel nooit alleen op kleur leunt', () => {
    expect(BEZETTING_LABEL.geen).toBe('geen verlof mogelijk');
    expect(Object.keys(BEZETTING_LABEL).sort()).toEqual(['deels', 'geen', 'volzet', 'vrij']);
  });
});
