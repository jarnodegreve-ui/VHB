import { describe, it, expect } from 'vitest';
import { maandGrenzen } from '../api/helpers';

/**
 * De grenzen waarmee het maandbord en de dagafsluiting hun matrixrijen
 * begrenzen. Een te krappe bovengrens laat stil de laatste dag van de maand
 * uit het bord vallen, en dat ziet niemand tot er die dag iemand moet rijden.
 */
describe('maandGrenzen', () => {
  it('geeft de eerste en laatste dag van een maand van 31 dagen', () => {
    expect(maandGrenzen('2026-07')).toEqual({ van: '2026-07-01', tot: '2026-07-31' });
  });

  it('geeft de laatste dag van een maand van 30 dagen', () => {
    expect(maandGrenzen('2026-09')).toEqual({ van: '2026-09-01', tot: '2026-09-30' });
  });

  it('kent februari in een gewoon jaar', () => {
    expect(maandGrenzen('2026-02')).toEqual({ van: '2026-02-01', tot: '2026-02-28' });
  });

  it('kent februari in een schrikkeljaar', () => {
    expect(maandGrenzen('2028-02')).toEqual({ van: '2028-02-01', tot: '2028-02-29' });
  });

  it('rekent december zonder over het jaar heen te vallen', () => {
    expect(maandGrenzen('2026-12')).toEqual({ van: '2026-12-01', tot: '2026-12-31' });
  });

  it('weigert alles wat geen welgevormde maand is', () => {
    // null = geen filter, dus de aanroeper leest de volledige matrix. Dat is
    // traag maar juist; een leeg bereik zou een leeg bord opleveren.
    for (const rauw of ['', '2026', '2026-00', '2026-13', '2026-9', '2026-09-01', 'onzin']) {
      expect(maandGrenzen(rauw)).toBeNull();
    }
    expect(maandGrenzen(undefined as unknown as string)).toBeNull();
  });
});
