import { describe, expect, it } from 'vitest';
import {
  MAX_PERIODE_DAGEN, bereikToestand, dagenInPeriode, herkenPeriode, isIsoDag, jaarPeriode, periodeFout, periodeVoor,
} from './periode';

/**
 * Zone-loze ISO-dagen: deze tests moeten in elke tijdzone hetzelfde geven.
 * Gecontroleerd met `TZ=Europe/Brussels` én `TZ=UTC` (en voor de grap
 * `TZ=Pacific/Kiritimati`): de functies lezen de klok van de runtime niet.
 */
describe('periodeVoor (snelkeuzes)', () => {
  it('deze maand: eerste tot laatste dag, ook in februari van een schrikkeljaar', () => {
    expect(periodeVoor('deze-maand', '2026-09-20')).toEqual({ van: '2026-09-01', tot: '2026-09-30' });
    expect(periodeVoor('deze-maand', '2028-02-10')).toEqual({ van: '2028-02-01', tot: '2028-02-29' });
    expect(periodeVoor('deze-maand', '2026-02-28')).toEqual({ van: '2026-02-01', tot: '2026-02-28' });
  });

  it('vorige maand schuift over de jaargrens', () => {
    expect(periodeVoor('vorige-maand', '2026-01-15')).toEqual({ van: '2025-12-01', tot: '2025-12-31' });
    expect(periodeVoor('vorige-maand', '2026-03-31')).toEqual({ van: '2026-02-01', tot: '2026-02-28' });
  });

  it('dit kwartaal: de vier kwartalen en hun grenzen', () => {
    expect(periodeVoor('dit-kwartaal', '2026-01-01')).toEqual({ van: '2026-01-01', tot: '2026-03-31' });
    expect(periodeVoor('dit-kwartaal', '2026-03-31')).toEqual({ van: '2026-01-01', tot: '2026-03-31' });
    expect(periodeVoor('dit-kwartaal', '2026-04-01')).toEqual({ van: '2026-04-01', tot: '2026-06-30' });
    expect(periodeVoor('dit-kwartaal', '2026-09-20')).toEqual({ van: '2026-07-01', tot: '2026-09-30' });
    expect(periodeVoor('dit-kwartaal', '2026-12-31')).toEqual({ van: '2026-10-01', tot: '2026-12-31' });
  });

  it('dit jaar', () => {
    expect(periodeVoor('dit-jaar', '2026-09-20')).toEqual({ van: '2026-01-01', tot: '2026-12-31' });
    expect(jaarPeriode(2028)).toEqual({ van: '2028-01-01', tot: '2028-12-31' });
  });

  it('op de dag van de zomer- en winteruurwissel verschuift er niets', () => {
    // 29/03/2026 en 25/10/2026: een lokale Date zou hier 23 of 25 uur tellen.
    expect(periodeVoor('deze-maand', '2026-03-29')).toEqual({ van: '2026-03-01', tot: '2026-03-31' });
    expect(periodeVoor('deze-maand', '2026-10-25')).toEqual({ van: '2026-10-01', tot: '2026-10-31' });
  });
});

describe('herkenPeriode', () => {
  it('herkent de snelkeuze uit de datums, anders vrij', () => {
    expect(herkenPeriode({ van: '2026-09-01', tot: '2026-09-30' }, '2026-09-20')).toBe('deze-maand');
    expect(herkenPeriode({ van: '2026-08-01', tot: '2026-08-31' }, '2026-09-20')).toBe('vorige-maand');
    expect(herkenPeriode({ van: '2026-07-01', tot: '2026-09-30' }, '2026-09-20')).toBe('dit-kwartaal');
    expect(herkenPeriode({ van: '2026-01-01', tot: '2026-12-31' }, '2026-09-20')).toBe('dit-jaar');
    expect(herkenPeriode({ van: '2026-09-02', tot: '2026-09-30' }, '2026-09-20')).toBe('vrij');
  });

  it('dezelfde datums zijn een maand later geen "deze maand" meer', () => {
    expect(herkenPeriode({ van: '2026-09-01', tot: '2026-09-30' }, '2026-10-01')).toBe('vorige-maand');
  });
});

describe('dagenInPeriode en isIsoDag', () => {
  it('telt begin en einde mee, ook over de uurwissel', () => {
    expect(dagenInPeriode({ van: '2026-09-01', tot: '2026-09-01' })).toBe(1);
    expect(dagenInPeriode({ van: '2026-03-01', tot: '2026-03-31' })).toBe(31);
    expect(dagenInPeriode({ van: '2026-10-01', tot: '2026-10-31' })).toBe(31);
    expect(dagenInPeriode({ van: '2026-01-01', tot: '2026-12-31' })).toBe(365);
    expect(dagenInPeriode({ van: '2028-01-01', tot: '2028-12-31' })).toBe(366);
  });

  it('omgekeerd of ongeldig = 0', () => {
    expect(dagenInPeriode({ van: '2026-09-02', tot: '2026-09-01' })).toBe(0);
    expect(dagenInPeriode({ van: '2026-02-30', tot: '2026-03-01' })).toBe(0);
  });

  it('isIsoDag weigert onmogelijke datums en andere vormen', () => {
    expect(isIsoDag('2026-02-28')).toBe(true);
    expect(isIsoDag('2028-02-29')).toBe(true);
    expect(isIsoDag('2026-02-29')).toBe(false);
    expect(isIsoDag('2026-13-01')).toBe(false);
    expect(isIsoDag('20/09/2026')).toBe(false);
    expect(isIsoDag('2026-09-20T00:00:00Z')).toBe(false);
    expect(isIsoDag(null)).toBe(false);
  });
});

describe('periodeFout', () => {
  it('geldige periode = null; een schrikkeljaar past net', () => {
    expect(periodeFout({ van: '2026-09-01', tot: '2026-09-30' })).toBeNull();
    expect(periodeFout({ van: '2028-01-01', tot: '2028-12-31' })).toBeNull();
    expect(MAX_PERIODE_DAGEN).toBe(366);
  });

  it('meldt de fout bij het juiste veld', () => {
    expect(periodeFout({ tot: '2026-09-30' })).toEqual({ veld: 'van', tekst: 'Kies een begindatum' });
    expect(periodeFout({ van: '2026-09-01' })).toEqual({ veld: 'tot', tekst: 'Kies een einddatum' });
    expect(periodeFout({ van: '2026-09-02', tot: '2026-09-01' })?.veld).toBe('tot');
    expect(periodeFout({ van: '2026-01-01', tot: '2027-01-02' })).toEqual({ veld: 'tot', tekst: 'Kies een periode van hoogstens 366 dagen' });
  });
});

describe('bereikToestand', () => {
  const bereik = { van: '2026-03-01', tot: '2026-10-15' };
  it('onderscheidt geen bron, buiten, deels en binnen', () => {
    expect(bereikToestand(jaarPeriode(2026), null)).toBe('geen-bron');
    expect(bereikToestand(jaarPeriode(2025), bereik)).toBe('buiten');
    expect(bereikToestand(jaarPeriode(2027), bereik)).toBe('buiten');
    expect(bereikToestand(jaarPeriode(2026), bereik)).toBe('deels');
    expect(bereikToestand({ van: '2026-04-01', tot: '2026-04-30' }, bereik)).toBe('binnen');
  });

  it('een periode die verder loopt dan de laatste gegevens is geen "deels"', () => {
    expect(bereikToestand({ van: '2026-10-01', tot: '2026-10-31' }, bereik)).toBe('binnen');
  });

  it('de randdagen tellen mee', () => {
    expect(bereikToestand({ van: '2026-02-01', tot: '2026-02-28' }, bereik)).toBe('buiten');
    expect(bereikToestand({ van: '2026-02-01', tot: '2026-03-01' }, bereik)).toBe('binnen');
    expect(bereikToestand({ van: '2026-10-15', tot: '2026-10-20' }, bereik)).toBe('binnen');
    expect(bereikToestand({ van: '2026-10-16', tot: '2026-10-20' }, bereik)).toBe('buiten');
  });

  it('een gat van hoogstens een maand vóór de eerste gegevens is geen "deels"', () => {
    // Het eerste verlof van het jaar valt op 5 januari: daar hoort geen waarschuwing bij.
    expect(bereikToestand(jaarPeriode(2026), { van: '2026-01-05', tot: '2026-12-23' })).toBe('binnen');
    expect(bereikToestand(jaarPeriode(2026), { van: '2026-02-01', tot: '2026-12-23' })).toBe('binnen');
    expect(bereikToestand(jaarPeriode(2026), { van: '2026-02-02', tot: '2026-12-23' })).toBe('deels');
  });
});
