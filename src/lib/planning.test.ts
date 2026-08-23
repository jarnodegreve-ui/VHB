import { describe, it, expect } from 'vitest';
import { normalizePlanningToken, sortedNameToken, suggestClosestName, vindNaamBotsingen } from './planning';

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

  it('suggestClosestName: vindt de bedoelde chauffeur bij een typo, of niets bij te ver', () => {
    const kandidaten = [
      { id: '1', name: 'Duysburgh Pascal' },
      { id: '2', name: 'Jan Janssen' },
    ];
    // Typo in de achternaam + omgekeerde volgorde → toch Duysburgh Pascal.
    expect(suggestClosestName('Pascal Duysbergh', kandidaten)?.id).toBe('1');
    // Totaal andere naam → geen suggestie.
    expect(suggestClosestName('Xavier Vermeulen', kandidaten)).toBeNull();
  });

  it('vindNaamBotsingen: zelfde naam, omgekeerde volgorde en accenten botsen; eigen id niet', () => {
    const users = [
      { id: '1', name: 'Ivan Van Hoorde' },
      { id: '2', name: 'Van Hoorde Ivan' },
      { id: '3', name: 'Désiré Peeters' },
      { id: '4', name: 'Jan Janssen' },
    ];
    // Exacte naam én omgekeerde volgorde tellen als botsing (zo koppelt de
    // server matrixcellen — case Ivan Van Hoorde, 23-08).
    expect(vindNaamBotsingen('Ivan Van Hoorde', users).map((u) => u.id)).toEqual(['1', '2']);
    // Accentverschil botst ook.
    expect(vindNaamBotsingen('Desire Peeters', users).map((u) => u.id)).toEqual(['3']);
    // Bij bewerken telt het account zelf niet mee.
    expect(vindNaamBotsingen('Jan Janssen', users, '4')).toEqual([]);
    // Lege naam → nooit een botsing.
    expect(vindNaamBotsingen('   ', users)).toEqual([]);
  });
});
