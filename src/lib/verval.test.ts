import { describe, expect, it } from 'vitest';
import { dagenTotVerval, kortVervalDatum, vandaagLokaal, vervalDagenTekst, vervalStil, vervalToon } from './verval';

describe('vervalregels', () => {
  it('rekent hele dagen vanaf vandaag, negatief = verlopen', () => {
    expect(dagenTotVerval('2026-09-23', '2026-09-23')).toBe(0);
    expect(dagenTotVerval('2026-10-23', '2026-09-23')).toBe(30);
    expect(dagenTotVerval('2026-09-20', '2026-09-23')).toBe(-3);
    // Over de zomertijdwissel (25/10) blijft het een heel getal.
    expect(dagenTotVerval('2026-10-26', '2026-10-24')).toBe(2);
  });

  it('toon per termijn: verlopen rood, 30 d amber, 90 d oker, daarna groen', () => {
    expect(vervalToon(-1)).toBe('red');
    expect(vervalToon(0)).toBe('amber');
    expect(vervalToon(30)).toBe('amber');
    expect(vervalToon(31)).toBe('oker');
    expect(vervalToon(90)).toBe('oker');
    expect(vervalToon(91)).toBe('emerald');
  });

  it('stil zolang het meer dan 30 dagen is', () => {
    expect(vervalStil(30)).toBe(false);
    expect(vervalStil(31)).toBe(true);
    expect(vervalStil(-5)).toBe(false);
  });

  it('dagentekst', () => {
    expect(vervalDagenTekst(-2)).toBe('verlopen');
    expect(vervalDagenTekst(0)).toBe('vandaag');
    expect(vervalDagenTekst(12)).toBe('12 d');
  });

  it('korte datum dag-maand-jaar, onleesbaar blijft zoals het was', () => {
    // De vorm van src/lib/format.ts: geen afkortingspunt, geen voorloopnul, in elke motor.
    expect(kortVervalDatum('2027-11-27')).toBe('27 nov 2027');
    expect(kortVervalDatum('2026-10-08')).toBe('8 okt 2026');
    // Een tijdstempel telt als zijn Brusselse dag, niet als de eerste tien tekens.
    expect(kortVervalDatum('2026-11-04T23:30:00Z')).toBe('5 nov 2026');
    expect(kortVervalDatum('onzin')).toBe('onzin');
  });

  it('vandaag in de lokale tijdzone', () => {
    expect(vandaagLokaal(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
