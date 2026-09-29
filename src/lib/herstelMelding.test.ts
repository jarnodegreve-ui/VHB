import { describe, expect, it } from 'vitest';
import { herstelMelding } from './herstelMelding';

describe('herstelMelding', () => {
  it('zegt gewoon "hersteld" als alles terug is, ook zonder bijlagen', () => {
    expect(herstelMelding('Omleiding', 0, 0)).toEqual({ tekst: 'Omleiding hersteld.', toon: 'success' });
    expect(herstelMelding('Update', 2, 2)).toEqual({ tekst: 'Update hersteld.', toon: 'success' });
  });

  it('zegt eerlijk dat de enige PDF niet mee terugkwam', () => {
    expect(herstelMelding('Omleiding', 1, 0)).toEqual({
      tekst: 'Omleiding hersteld, maar de PDF kwam niet mee terug. Voeg hem opnieuw toe.',
      toon: 'info',
    });
  });

  it('telt hoeveel van de PDF’s ontbreken', () => {
    expect(herstelMelding('Update', 2, 1).tekst).toBe('Update hersteld, maar 1 van de 2 PDF’s kwam niet mee terug. Voeg hem opnieuw toe.');
    expect(herstelMelding('Omleiding', 5, 0).tekst).toBe('Omleiding hersteld, maar 5 van de 5 PDF’s kwamen niet mee terug. Voeg ze opnieuw toe.');
  });

  it('meer terug dan verwacht is geen verlies', () => {
    expect(herstelMelding('Omleiding', 1, 2).toon).toBe('success');
  });
});
