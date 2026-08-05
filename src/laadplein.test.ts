import { describe, it, expect } from 'vitest';
import { BUS_PER_LAADPUNT, busVoorLaadpunt } from './lib/laadplein';

describe('laadplein-mapping', () => {
  it('kent de bevestigde vaste plaatsen (plattegrond 05-08)', () => {
    expect(busVoorLaadpunt('1')).toBe('40');
    expect(busVoorLaadpunt('2')).toBe('43');
    expect(busVoorLaadpunt('11')).toBe('27');
    expect(busVoorLaadpunt('12.A')).toBe('26');
    expect(busVoorLaadpunt('15.A')).toBe('33');
  });

  it('geeft null voor punten zonder vaste bus (keuze Jarno: R-bussen, S 44, XX)', () => {
    for (const punt of ['3', '15.B', '16', '17.A', '17.B', '18.A', '18.B']) {
      expect(busVoorLaadpunt(punt)).toBeNull();
    }
    expect(busVoorLaadpunt('')).toBeNull();
    expect(busVoorLaadpunt(undefined)).toBeNull();
  });

  it('bevat exact 17 vaste plaatsen zonder R/S-prefixen', () => {
    const waarden = Object.values(BUS_PER_LAADPUNT);
    expect(waarden).toHaveLength(17);
    for (const bus of waarden) expect(bus).toMatch(/^\d+$/);
    // Geen dubbele bussen: elke bus staat op precies één plek.
    expect(new Set(waarden).size).toBe(waarden.length);
  });
});
