import { describe, expect, it } from 'vitest';
import { delenMetGelijkeTijden, gelijkeTijdenMelding } from './gelijkeTijden';

describe('delenMetGelijkeTijden (Jarno 29-09, 28b)', () => {
  it('noemt elk deel met gelijke begin- en eindtijd, met dienst, deel en de velden', () => {
    const uit = delenMetGelijkeTijden([
      { serviceNumber: '2115', startTime: '06:00', endTime: '09:00', startTime2: '08:00', endTime2: '08:00' },
      { serviceNumber: ' 2116 ', startTime: '00:00', endTime: '00:00', startTime3: '8:00', endTime3: '08:00' },
    ]);
    expect(uit.map((g) => [g.dienst, g.deel, g.start, g.einde])).toEqual([
      ['2115', 2, 'startTime2', 'endTime2'],
      ['2116', 1, 'startTime', 'endTime'],
      ['2116', 3, 'startTime3', 'endTime3'],
    ]);
    expect(uit[0].melding).toBe('Deel 2 van dienst 2115 heeft dezelfde begin- en eindtijd (08:00). Een dienst van een etmaal schrijf je in busvak-uren, bv. 08:00 tot 32:00.');
  });

  it('geldige delen en delen zonder twee leesbare tijden zijn geen fout', () => {
    expect(delenMetGelijkeTijden([
      { serviceNumber: '1', startTime: '22:00', endTime: '06:00' },
      { serviceNumber: '2', startTime: '16:00', endTime: '00:00' },
      { serviceNumber: '3', startTime: '08:00', endTime: '32:00' },
      { serviceNumber: '4', startTime: '', endTime: '', startTime2: '08:00', endTime2: '' },
      { serviceNumber: '5', startTime: '48:00', endTime: '48:00' },
    ])).toEqual([]);
    // Een kapotte back-up (geen object) gooit niet.
    expect(delenMetGelijkeTijden([null, 5, 'x'] as never)).toEqual([]);
  });

  it('het voorbeeld rekent vanaf de eigen begintijd, zolang dat plus 24 uur een busvak-tijd is', () => {
    expect(gelijkeTijdenMelding('2101', 1, 0)).toBe('Deel 1 van dienst 2101 heeft dezelfde begin- en eindtijd (00:00). Een dienst van een etmaal schrijf je in busvak-uren, bv. 00:00 tot 24:00.');
    expect(gelijkeTijdenMelding('2101', 3, 6 * 60 + 15)).toContain('bv. 06:15 tot 30:15.');
    // 24:30 plus een etmaal is 48:30, geen busvak-tijd meer: het vaste voorbeeld.
    expect(gelijkeTijdenMelding('2101', 2, 24 * 60 + 30)).toBe('Deel 2 van dienst 2101 heeft dezelfde begin- en eindtijd (24:30). Een dienst van een etmaal schrijf je in busvak-uren, bv. 08:00 tot 32:00.');
  });
});
