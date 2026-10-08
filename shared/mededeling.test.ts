import { describe, expect, it } from 'vitest';
import { GEEN_MEDEDELING, MEDEDELING_TEKST_MAX, mededelingZichtbaar, parseMededeling } from './mededeling';

describe('mededeling voor de chauffeurs', () => {
  it('leest een geldige instelling en valt bij rommel terug op geen mededeling', () => {
    expect(parseMededeling({ tekst: ' Opgelet, vanaf 11/12 nieuwe dienstregeling! ', tonen: true, tot: '2026-12-11' }))
      .toEqual({ tekst: 'Opgelet, vanaf 11/12 nieuwe dienstregeling!', tonen: true, tot: '2026-12-11' });
    expect(parseMededeling(null)).toEqual(GEEN_MEDEDELING);
    expect(parseMededeling('tekst')).toEqual(GEEN_MEDEDELING);
    expect(parseMededeling({ tekst: 5, tonen: 'ja', tot: '11/12/2026' })).toEqual({ tekst: '', tonen: false, tot: null });
    expect(parseMededeling({ tekst: 'x'.repeat(500), tonen: true }).tekst).toHaveLength(MEDEDELING_TEKST_MAX);
  });

  it('is zichtbaar zolang ze aanstaat, tekst heeft en de einddag niet voorbij is', () => {
    const m = { tekst: 'Nieuwe dienstregeling vanaf 11/12.', tonen: true, tot: '2026-12-11' };
    expect(mededelingZichtbaar(m, '2026-10-08')).toBe(true);
    expect(mededelingZichtbaar(m, '2026-12-11')).toBe(true);
    expect(mededelingZichtbaar(m, '2026-12-12')).toBe(false);
    expect(mededelingZichtbaar({ ...m, tot: null }, '2030-01-01')).toBe(true);
    expect(mededelingZichtbaar({ ...m, tonen: false }, '2026-10-08')).toBe(false);
    expect(mededelingZichtbaar({ ...m, tekst: '   ' }, '2026-10-08')).toBe(false);
  });
});
