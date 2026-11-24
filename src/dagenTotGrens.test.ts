// @vitest-environment node
/**
 * Welke dagen een overzicht van de planning telt (api/_lib/dagenTotGrens.ts):
 * tot en met de grens van de planning, de laatste dag met een dienst (24-11).
 * De drie aanroepers (format=summary, het tweede Excel-tabblad en het rapport
 * Overzicht per chauffeur) staan in src/rapportPlanning.test.ts en
 * src/apiIntegratie/planning.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { dagenTotGrens, naGrens } from '../api/_lib/dagenTotGrens';

const januari = Array.from({ length: 31 }, (_, i) => `2027-01-${String(i + 1).padStart(2, '0')}`);

describe('dagenTotGrens', () => {
  it('de grens midden in de maand: alleen de dagen tot en met de grens, in hun volgorde', () => {
    expect(dagenTotGrens(januari, '2027-01-03')).toEqual(['2027-01-01', '2027-01-02', '2027-01-03']);
    expect(dagenTotGrens(['2027-01-03', '2027-01-01', '2027-01-04'], '2027-01-03')).toEqual(['2027-01-03', '2027-01-01']);
  });

  it('de grens vóór de maand: niets telt; de grens erna of op de laatste dag: alles', () => {
    expect(dagenTotGrens(januari, '2026-12-31')).toEqual([]);
    expect(dagenTotGrens(januari, '2027-01-31')).toEqual(januari);
    expect(dagenTotGrens(januari, '2027-02-15')).toEqual(januari);
  });

  it('geen grens of geen geldige dag: niets wordt afgekapt (het gedrag van vóór 24-11)', () => {
    for (const geen of [null, undefined, '', '2027-02-30', '03/01/2027', '2027-1-3']) {
      expect(dagenTotGrens(januari, geen), String(geen)).toEqual(januari);
      expect(naGrens('2027-01-20', geen), String(geen)).toBe(false);
    }
  });

  it('geeft een nieuwe lijst en laat de dagen van het bord ongemoeid', () => {
    const bord = [...januari];
    const geteld = dagenTotGrens(bord, '2027-01-03');
    expect(bord).toEqual(januari);
    expect(geteld).not.toBe(bord);
    expect(dagenTotGrens(bord, null)).not.toBe(bord);
  });

  it('naGrens: alleen een dag die echt na de grens ligt', () => {
    expect(naGrens('2027-01-03', '2027-01-03')).toBe(false);
    expect(naGrens('2027-01-04', '2027-01-03')).toBe(true);
    expect(naGrens('2026-12-31', '2027-01-03')).toBe(false);
  });
});
