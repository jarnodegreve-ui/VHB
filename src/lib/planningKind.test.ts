import { describe, it, expect } from 'vitest';
import { celBadgeTone, celChipClass, celTextClass } from './planningKind';

/**
 * Celkleuren van het maandbeeld. De twee rode gevallen naast elkaar: ziek
 * (de code) en een weggeruilde dienst (Jarno 17-09, "vrij" moet rood zodat
 * je ziet dat die chauffeur een dienst gewisseld heeft). De ontvangende kant
 * van dezelfde wissel blijft geel.
 */
describe('celkleuren', () => {
  const dienst = { kind: 'service' as const, code: '2101' };

  it('een gewone dienst volgt de soort', () => {
    expect(celChipClass(dienst)).toContain('oker');
    expect(celBadgeTone(dienst)).toBe('oker');
  });

  it('een geruilde of overgezette dienst is geel', () => {
    expect(celChipClass({ ...dienst, swapId: 'sw1' })).toContain('amber');
    expect(celBadgeTone({ ...dienst, swapId: 'sw1' })).toBe('amber');
  });

  it('de kant die zijn dienst wegruilde staat rood vrij', () => {
    const weg = { kind: 'absence' as const, code: 'vrij', swapId: 'sw1', swapAway: true };
    expect(celChipClass(weg)).toContain('red');
    expect(celTextClass(weg)).toContain('red');
    expect(celBadgeTone(weg)).toBe('red');
  });

  it('een gewone vrije dag blijft neutraal', () => {
    const vrij = { kind: 'absence' as const, code: 'vrij' };
    expect(celChipClass(vrij)).not.toContain('red');
    expect(celBadgeTone(vrij)).toBe('slate');
  });

  it('ziek blijft rood, ook zonder wissel', () => {
    expect(celChipClass({ kind: 'absence', code: 'ziek' })).toContain('red');
  });
});
