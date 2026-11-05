import { describe, expect, it } from 'vitest';
import { brusselOffsetMin, uurwisselMin } from './uurwissel';

describe('uurwissel (controle-ronde 04-11, punt 35)', () => {
  it('kent de Brusselse verschuiving per dag: winter 60, zomer 120', () => {
    expect(brusselOffsetMin('2027-01-15')).toBe(60);
    expect(brusselOffsetMin('2027-07-15')).toBe(120);
    // De dag van de wissel zelf telt als de nieuwe tijd (gemeten op de middag).
    expect(brusselOffsetMin('2027-03-28')).toBe(120);
    expect(brusselOffsetMin('2027-10-31')).toBe(60);
  });

  it('nacht 27 op 28 maart 2027: +60 (23 uur); 30 op 31 oktober 2027: -60 (25 uur); gewone nacht 0', () => {
    expect(uurwisselMin('2027-03-27', '2027-03-28')).toBe(60);
    expect(uurwisselMin('2027-10-30', '2027-10-31')).toBe(-60);
    expect(uurwisselMin('2026-10-06', '2026-10-07')).toBe(0);
    expect(uurwisselMin('2026-03-28', '2026-03-29')).toBe(60);
    expect(uurwisselMin('2026-10-24', '2026-10-25')).toBe(-60);
  });

  it('wat geen datum is telt als 0', () => {
    expect(brusselOffsetMin('')).toBe(0);
    expect(brusselOffsetMin('27/03/2027')).toBe(0);
    expect(uurwisselMin('x', '2027-03-28')).toBe(120);
  });
});
