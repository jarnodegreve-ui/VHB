import { describe, it, expect } from 'vitest';
import { celBadgeTone, celChipClass, celTextClass } from './planningKind';

/**
 * Celkleuren van het maandbeeld. Sinds 17-09 spreekt het bord de taal van
 * Jarno's Excel: rood = dienstruil (beide kanten), geel/oranje = ziekte.
 */
describe('celkleuren', () => {
  const dienst = { kind: 'service' as const, code: '2101' };

  it('een gewone dienst volgt de soort', () => {
    expect(celChipClass(dienst)).toContain('slate');
    expect(celBadgeTone(dienst)).toBe('slate');
  });

  it('een geruilde of overgezette dienst is rood', () => {
    expect(celChipClass({ ...dienst, swapId: 'sw1' })).toContain('red');
    expect(celTextClass({ ...dienst, swapId: 'sw1' })).toContain('red');
    expect(celBadgeTone({ ...dienst, swapId: 'sw1' })).toBe('red');
  });

  it('de kant die zijn dienst wegruilde staat even rood vrij: één kleur per wissel', () => {
    const weg = { kind: 'absence' as const, code: 'vrij', swapId: 'sw1' };
    expect(celChipClass(weg)).toBe(celChipClass({ ...dienst, swapId: 'sw1' }));
    expect(celBadgeTone(weg)).toBe('red');
  });

  it('een gewone vrije dag blijft neutraal', () => {
    const vrij = { kind: 'absence' as const, code: 'vrij' };
    expect(celChipClass(vrij)).not.toContain('red');
    expect(celBadgeTone(vrij)).toBe('slate');
  });

  it('ziek is geel/oranje, ook al staat de code in een andere categorie', () => {
    expect(celChipClass({ kind: 'absence', code: 'ziek' })).toContain('amber');
    expect(celTextClass({ kind: 'leave', code: 'Ziek' })).toContain('amber');
    expect(celBadgeTone({ kind: 'absence', code: 'ziek' })).toBe('amber');
  });

  it('een ziekmelding die óók uit een wissel komt blijft rood: de wissel wint', () => {
    expect(celChipClass({ kind: 'absence', code: 'ziek', swapId: 'sw1' })).toContain('red');
  });
});
