import { describe, it, expect } from 'vitest';
import { minutesBetween } from './views/PrintMonthlyScheduleView';

/** Urenberekening van de maandprint — de drie tijdnotaties van het portaal. */
describe('minutesBetween (maandprint)', () => {
  it('gewone dienst', () => {
    expect(minutesBetween('08:00', '16:30')).toBe(510);
  });
  it('impliciete nachtdienst (eind ≤ start) telt +24u, was 0', () => {
    expect(minutesBetween('22:00', '06:00')).toBe(480);
  });
  it('busvak-notatie blijft correct', () => {
    expect(minutesBetween('15:41', '26:16')).toBe(635);
  });
  it('kapotte invoer blijft 0', () => {
    expect(minutesBetween('x', '16:00')).toBe(0);
  });
});
