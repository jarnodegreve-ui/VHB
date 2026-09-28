import { describe, expect, it } from 'vitest';
import { heeftRol, isTechnieker } from './toegang';

/**
 * "Ook technieker" (28-09): een chauffeur met de schakelaar telt als
 * technieker voor toegang en ontvangers, en blijft voor al de rest chauffeur.
 */
const TECHNIEK = ['technieker', 'planner', 'admin'] as const;

describe('isTechnieker', () => {
  it('de rol technieker, of een chauffeur met de schakelaar', () => {
    expect(isTechnieker({ role: 'technieker' })).toBe(true);
    expect(isTechnieker({ role: 'chauffeur', ookTechnieker: true })).toBe(true);
    expect(isTechnieker({ role: 'chauffeur' })).toBe(false);
    expect(isTechnieker({ role: 'chauffeur', ookTechnieker: false })).toBe(false);
  });

  it('de schakelaar telt alleen bij een chauffeur: staf wordt er geen mecanicien door', () => {
    expect(isTechnieker({ role: 'planner', ookTechnieker: true })).toBe(false);
    expect(isTechnieker({ role: 'admin', ookTechnieker: true })).toBe(false);
  });
});

describe('heeftRol', () => {
  it('een chauffeur met de schakelaar mag wat een technieker mag, en blijft chauffeur', () => {
    const beide = { role: 'chauffeur', ookTechnieker: true };
    expect(heeftRol(beide, TECHNIEK)).toBe(true);
    expect(heeftRol(beide, ['chauffeur', 'planner', 'admin'])).toBe(true);
    // Geen staf: planner- en adminrechten komen er nooit mee.
    expect(heeftRol(beide, ['planner', 'admin'])).toBe(false);
    expect(heeftRol(beide, ['admin'])).toBe(false);
  });

  it('zonder schakelaar verandert er niets', () => {
    expect(heeftRol({ role: 'chauffeur' }, TECHNIEK)).toBe(false);
    expect(heeftRol({ role: 'technieker' }, TECHNIEK)).toBe(true);
    expect(heeftRol({ role: 'planner' }, TECHNIEK)).toBe(true);
    expect(heeftRol({ role: 'technieker' }, ['chauffeur', 'planner', 'admin'])).toBe(false);
  });
});
