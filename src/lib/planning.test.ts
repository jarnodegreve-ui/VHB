import { describe, it, expect } from 'vitest';
import { normalizePlanningToken, sortedNameToken } from './planning';

describe('planning: naam-/codenormalisatie (gelijk aan server toLookupToken)', () => {
  it('strippt accenten en interpunctie', () => {
    expect(normalizePlanningToken('Jean-Pierre')).toBe('jean pierre');
    expect(normalizePlanningToken('Désiré')).toBe('desire');
    expect(normalizePlanningToken('  Dienst_12  ')).toBe('dienst 12');
  });

  it('sortedNameToken matcht een omgekeerde naamvolgorde', () => {
    // "Jan Janssen" en "Janssen Jan" leveren dezelfde sleutel → geen valse
    // "niet-gematchte chauffeur" in het Planning-overzicht.
    expect(sortedNameToken('Jan Janssen')).toBe(sortedNameToken('Janssen Jan'));
    expect(sortedNameToken('Duysburgh Pascal')).toBe('duysburgh pascal');
  });
});
