import { describe, expect, it } from 'vitest';
import { lijnLabel, lijnenNaarTekst, lijnenVan, raaktLijn } from '../../shared/lijnen';

describe('lijnen van een omleiding', () => {
  it('splitst wat mensen typen en ontdubbelt met behoud van volgorde', () => {
    expect(lijnenVan('883, 884')).toEqual(['883', '884']);
    expect(lijnenVan('50;58/82 & 58')).toEqual(['50', '58', '82']);
    expect(lijnenVan('Lijn 801')).toEqual(['801']);
    expect(lijnenVan('lijnen 5 en 8')).toEqual(['5', '8']);
    expect(lijnenVan('  12  ')).toEqual(['12']);
    expect(lijnenVan('')).toEqual([]);
    expect(lijnenVan(null)).toEqual([]);
  });

  it('kent "Alle" als speciaal geval, ook tussen andere nummers', () => {
    expect(lijnenVan('Alle')).toEqual(['Alle']);
    expect(lijnenVan('alle')).toEqual(['Alle']);
    expect(lijnenVan('5, alle')).toEqual(['Alle']);
  });

  it('schrijft canoniek weg met ", " zodat bestaande data ("883, 884") gelijk blijft', () => {
    expect(lijnenNaarTekst(['883', '884'])).toBe('883, 884');
    expect(lijnenNaarTekst(['883', ' 884 ', '883'])).toBe('883, 884');
    expect(lijnenNaarTekst([])).toBe('');
    expect(lijnenNaarTekst(['Alle'])).toBe('Alle');
  });

  it('maakt een leesbaar label', () => {
    expect(lijnLabel('801')).toBe('Lijn 801');
    expect(lijnLabel('883, 884')).toBe('Lijnen 883 en 884');
    expect(lijnLabel('50, 58, 82')).toBe('Lijnen 50, 58 en 82');
    expect(lijnLabel('Alle')).toBe('Alle lijnen');
    expect(lijnLabel('Lijn 5 & 8')).toBe('Lijnen 5 en 8');
    expect(lijnLabel('')).toBe('Lijn onbekend');
  });

  it('matcht een lijn op een omleiding, "Alle" altijd', () => {
    expect(raaktLijn('883, 884', '884')).toBe(true);
    expect(raaktLijn('883, 884', '88')).toBe(false);
    expect(raaktLijn('Alle', '12')).toBe(true);
    expect(raaktLijn('', '12')).toBe(false);
  });
});
