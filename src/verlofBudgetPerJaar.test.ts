// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BETAALD_VERLOF_BUDGET, verlofBalans, verlofBudgetVoorJaar, verlofBudgettenSchoon } from '../shared/verlofSaldo';

/**
 * Verlofbudget per jaar (09-10): het standaardbudget van de persoon blijft,
 * een afwijking per jaar wint voor dat jaar alleen.
 */
describe('verlofBudgetVoorJaar', () => {
  it('het jaar zelf wint, anders het standaardbudget, anders 24', () => {
    const persoon = { verlofBudget: 20, verlofBudgetten: { '2027': 18 } };
    expect(verlofBudgetVoorJaar(persoon, 2027)).toBe(18);
    expect(verlofBudgetVoorJaar(persoon, 2026)).toBe(20);
    expect(verlofBudgetVoorJaar({ verlofBudgetten: { '2027': 18 } }, 2026)).toBe(BETAALD_VERLOF_BUDGET);
    expect(verlofBudgetVoorJaar(undefined, 2026)).toBe(BETAALD_VERLOF_BUDGET);
    expect(verlofBudgetVoorJaar(null, 2026)).toBe(BETAALD_VERLOF_BUDGET);
  });

  it('een jaar met nul dagen telt als nul, een onzinnige waarde valt terug op het standaardbudget', () => {
    expect(verlofBudgetVoorJaar({ verlofBudget: 20, verlofBudgetten: { '2027': 0 } }, 2027)).toBe(0);
    expect(verlofBudgetVoorJaar({ verlofBudget: 20, verlofBudgetten: { '2027': -1 } }, 2027)).toBe(20);
    expect(verlofBudgetVoorJaar({ verlofBudget: 20, verlofBudgetten: { '2027': 2.5 } }, 2027)).toBe(20);
  });

  it('verlofBalans leest de persoon: een budget voor 2027 raakt 2026 niet', () => {
    const persoon = { verlofBudget: 24, verlofBudgetten: { '2027': 20 } };
    expect(verlofBalans([], 'x', 2026, persoon).betaaldBudget).toBe(24);
    expect(verlofBalans([], 'x', 2027, persoon).betaaldBudget).toBe(20);
    // Een los getal werkt nog (oude aanroepers en tests).
    expect(verlofBalans([], 'x', 2026, 10).betaaldBudget).toBe(10);
    expect(verlofBalans([], 'x', 2026, undefined).betaaldBudget).toBe(24);
  });
});

describe('verlofBudgettenSchoon', () => {
  it('houdt alleen jaren van vier cijfers met een geheel aantal dagen van nul of meer', () => {
    expect(verlofBudgettenSchoon({ '2027': 22, '2026': 0, '27': 5, 'abc': 3, '2028': -1, '2029': 1.5, '2030': '12' })).toEqual({ '2027': 22, '2026': 0 });
  });

  it('leeg, geen object of een lijst = undefined', () => {
    expect(verlofBudgettenSchoon({})).toBeUndefined();
    expect(verlofBudgettenSchoon(null)).toBeUndefined();
    expect(verlofBudgettenSchoon([2027])).toBeUndefined();
    expect(verlofBudgettenSchoon('2027')).toBeUndefined();
  });
});

describe('verlofBudgettenGeldig (het schema van de API)', () => {
  it('aanvaardt alleen jaren van vier cijfers met een geheel aantal dagen van nul of meer', async () => {
    const { verlofBudgettenGeldig } = await import('../shared/verlofSaldo');
    expect(verlofBudgettenGeldig({ '2027': 18 })).toBe(true);
    expect(verlofBudgettenGeldig({})).toBe(true);
    expect(verlofBudgettenGeldig({ '27': 18 })).toBe(false);
    expect(verlofBudgettenGeldig({ '2027': -1 })).toBe(false);
    expect(verlofBudgettenGeldig({ '2027': 1.5 })).toBe(false);
    expect(verlofBudgettenGeldig([2027])).toBe(false);
    expect(verlofBudgettenGeldig(null)).toBe(false);
  });
});
