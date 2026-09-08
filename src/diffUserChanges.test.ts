// @vitest-environment node
/**
 * Gebruikers-diff (08-09-2026): een lege telefoon/e-mail uit het formulier
 * ('') tegenover NULL in de database is géén wijziging. Voorheen logde elke
 * opslag van de gebruikerslijst "Gebruiker gewijzigd: telefoon" voor iedereen
 * zonder nummer.
 */
import { describe, it, expect } from 'vitest';
import { diffUserChanges } from '../api/storage';

const basis = { id: '1', name: 'Test Chauffeur', role: 'chauffeur' as const, employeeId: 'VHB-000001', isActive: true };

describe('diffUserChanges', () => {
  it('ziet null en een lege string als gelijk (telefoon, e-mail, personeelsnummer)', () => {
    const uit = diffUserChanges(
      [{ ...basis, phone: null as any, email: null as any }],
      [{ ...basis, phone: '', email: '' }],
    );
    expect(uit.changed).toEqual([]);
    expect(uit.added).toEqual([]);
    expect(uit.removed).toEqual([]);
  });
  it('meldt een echte wijziging nog wél', () => {
    const uit = diffUserChanges(
      [{ ...basis, phone: null as any }],
      [{ ...basis, phone: '0470 00 00 00' }],
    );
    expect(uit.changed).toHaveLength(1);
    expect(uit.changed[0].fields).toEqual(['telefoon']);
  });
  it('negeert spaties eromheen', () => {
    const uit = diffUserChanges([{ ...basis, phone: '0470 11 11 11' }], [{ ...basis, phone: ' 0470 11 11 11 ' }]);
    expect(uit.changed).toEqual([]);
  });
});
