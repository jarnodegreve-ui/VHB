import { describe, expect, it } from 'vitest';
import { AVATAR_TINTEN, avatarTint, avatarTintIndex, initialen } from './Avatar';

describe('initialen', () => {
  it('neemt voor- en achternaam', () => {
    expect(initialen('Jarno De Greve')).toBe('JG');
    expect(initialen('jan janssen')).toBe('JJ');
  });
  it('neemt bij één woord de eerste twee letters', () => {
    expect(initialen('Beheerder')).toBe('BE');
    expect(initialen('É')).toBe('É');
  });
  it('negeert overtollige spaties en valt terug op ?', () => {
    expect(initialen('  Ann   Peeters  ')).toBe('AP');
    expect(initialen('')).toBe('?');
    expect(initialen('   ')).toBe('?');
  });
});

describe('avatarTint', () => {
  it('is deterministisch en ongevoelig voor hoofdletters/spaties', () => {
    expect(avatarTint('Jarno De Greve')).toBe(avatarTint('Jarno De Greve'));
    expect(avatarTint('jarno de greve')).toBe(avatarTint('  Jarno De Greve '));
  });
  it('blijft binnen de tintenlijst', () => {
    for (const naam of ['', 'A', 'Zoë Van den Bossche', 'Mohamed El Amrani', 'Beheerder']) {
      const i = avatarTintIndex(naam);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(AVATAR_TINTEN.length);
      expect(AVATAR_TINTEN).toContain(avatarTint(naam));
    }
  });
  it('spreidt verschillende namen over meerdere tinten', () => {
    const namen = ['Jan Janssen', 'Piet Peeters', 'An De Smet', 'Tom Claes', 'Els Maes', 'Bart Wouters', 'Lies Jacobs', 'Koen Mertens', 'Sofie Willems', 'Dirk Goossens'];
    const tinten = new Set(namen.map(avatarTint));
    expect(tinten.size).toBeGreaterThanOrEqual(4);
  });
  it('gebruikt alleen paren die in dark mode flippen (500-vlak, 800-tekst)', () => {
    for (const tint of AVATAR_TINTEN) expect(tint).toMatch(/^bg-[a-z]+-500\/12 text-[a-z]+-800$/);
  });
});
