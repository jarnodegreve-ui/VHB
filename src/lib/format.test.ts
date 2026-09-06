import { describe, it, expect } from 'vitest';
import { formatGetal, metEenheid } from './format';

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

describe('metEenheid (smalle vaste spatie tussen getal en eenheid)', () => {
  it('zet U+202F tussen getal en eenheid, voor ruwe én geformatteerde waarden', () => {
    expect(metEenheid(12, 'kW')).toBe('12\u202FkW');
    expect(metEenheid('6\u202F559', 'kWh')).toBe('6\u202F559\u202FkWh');
    expect(metEenheid(3, 'u')).toBe('3\u202Fu');
    expect(metEenheid(12, 'kW')).not.toContain(' ');
  });
  it('laat een streepje (onbekend) zonder eenheid', () => {
    expect(metEenheid(Number.NaN, 'kW')).toBe('—');
    expect(metEenheid('—', 'kWh')).toBe('—');
  });
});
