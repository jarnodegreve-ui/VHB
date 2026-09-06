import { describe, it, expect } from 'vitest';
import { formatGetal, formatRelatief } from './format';

describe('formatGetal (komma als decimaalteken, smalle spatie als duizendtal, max. 2 decimalen)', () => {
  it('kapt ChargEye-decimalen af op twee cijfers na de komma', () => {
    expect(formatGetal(123.45678)).toBe('123,46');
    expect(formatGetal(47.6)).toBe('47,6');
    expect(formatGetal(0.5)).toBe('0,5');
  });
  it('laat hele getallen heel en zet een smalle vaste spatie als duizendtal (geen punt: die leest als decimaal)', () => {
    expect(formatGetal(48)).toBe('48');
    expect(formatGetal(6559)).toBe('6\u202F559');
    expect(formatGetal(57529.6)).toBe('57\u202F529,6');
    expect(formatGetal(1234567)).toBe('1\u202F234\u202F567');
    expect(formatGetal(6559)).not.toContain('.');
  });
  it('respecteert een ander maximum en vangt onbruikbare waarden', () => {
    expect(formatGetal(1234.5, 0)).toBe('1\u202F235');
    expect(formatGetal(Number.NaN)).toBe('—');
    expect(formatGetal(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatRelatief', () => {
  const nu = Date.parse('2026-09-06T12:00:00Z');
  it('kiest de leesbare eenheid', () => {
    expect(formatRelatief('2026-09-06T11:59:40Z', nu)).toBe('zojuist');
    expect(formatRelatief('2026-09-06T11:55:00Z', nu)).toBe('5 min geleden');
    expect(formatRelatief('2026-09-06T09:00:00Z', nu)).toBe('3 u geleden');
    expect(formatRelatief('2026-09-05T11:00:00Z', nu)).toBe('gisteren');
    expect(formatRelatief('2026-09-02T12:00:00Z', nu)).toBe('4 d geleden');
    expect(formatRelatief('2026-08-01T12:00:00Z', nu)).toMatch(/augustus/);
    expect(formatRelatief(null, nu)).toBe('');
  });
});
