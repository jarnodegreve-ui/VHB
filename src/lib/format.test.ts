import { describe, it, expect } from 'vitest';
import { formatGetal } from './format';

describe('formatGetal (Belgische notatie, max. 2 decimalen)', () => {
  it('kapt ChargEye-decimalen af op twee cijfers na de komma', () => {
    expect(formatGetal(123.45678)).toBe('123,46');
    expect(formatGetal(47.6)).toBe('47,6');
    expect(formatGetal(0.5)).toBe('0,5');
  });
  it('laat hele getallen heel en zet een duizendtal-punt', () => {
    expect(formatGetal(48)).toBe('48');
    expect(formatGetal(6559)).toBe('6.559');
    expect(formatGetal(57529.6)).toBe('57.529,6');
  });
  it('respecteert een ander maximum en vangt onbruikbare waarden', () => {
    expect(formatGetal(1234.5, 0)).toBe('1.235');
    expect(formatGetal(Number.NaN)).toBe('—');
    expect(formatGetal(Number.POSITIVE_INFINITY)).toBe('—');
  });
});
