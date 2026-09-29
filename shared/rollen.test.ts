import { describe, expect, it } from 'vitest';
import { ROLLEN, ROL_FILTER, ROL_LABEL, pastBijRolFilter, rolLabel, rolRegel } from './rollen';
import { ROLLEN as ROLLEN_IN_SCHEMA } from './schemas/constanten';
import { ROL_IN_RAPPORT } from './rapporten/definities/personeel';

/**
 * De ene bron voor hoe een rol heet (29-09): labels, de combinatie met
 * "Ook technieker" en het rolfilter.
 */
describe('ROL_LABEL', () => {
  it('elke rol heeft een label: Chauffeur, Technieker, Planner, Beheerder', () => {
    expect(ROL_LABEL).toEqual({ chauffeur: 'Chauffeur', technieker: 'Technieker', planner: 'Planner', admin: 'Beheerder' });
    expect(Object.keys(ROL_LABEL).sort()).toEqual([...ROLLEN].sort());
    for (const rol of ROLLEN) expect(ROL_LABEL[rol].trim()).not.toBe('');
  });

  it('het gebruikersschema kent dezelfde rollen, in dezelfde volgorde', () => {
    expect(ROLLEN_IN_SCHEMA).toBe(ROLLEN);
    expect([...ROLLEN]).toEqual(['chauffeur', 'technieker', 'planner', 'admin']);
  });
});

describe('rolLabel', () => {
  it('vertaalt een rolwaarde van buiten (logregel, server)', () => {
    expect(rolLabel('admin')).toBe('Beheerder');
    expect(rolLabel('planner')).toBe('Planner');
    expect(rolLabel('technieker')).toBe('Technieker');
    expect(rolLabel('chauffeur')).toBe('Chauffeur');
  });

  it('een onbekende waarde blijft staan zoals ze is, een lege blijft leeg', () => {
    expect(rolLabel('systeem')).toBe('systeem');
    expect(rolLabel('')).toBe('');
    expect(rolLabel(null)).toBe('');
    expect(rolLabel(undefined)).toBe('');
  });

  it('het label is geen sleutel: de waarde "Admin" of "Beheerder" is geen rol', () => {
    expect(rolLabel('Admin')).toBe('Admin');
    expect((ROLLEN as readonly string[]).includes('Beheerder')).toBe(false);
  });
});

describe('rolRegel', () => {
  it('een chauffeur met "Ook technieker" toont beide, chauffeur voorop', () => {
    expect(rolRegel({ role: 'chauffeur', ookTechnieker: true })).toBe('Chauffeur + Technieker');
  });

  it('zonder de schakelaar gewoon het label van de rol', () => {
    expect(rolRegel({ role: 'chauffeur' })).toBe('Chauffeur');
    expect(rolRegel({ role: 'chauffeur', ookTechnieker: false })).toBe('Chauffeur');
    expect(rolRegel({ role: 'technieker' })).toBe('Technieker');
    expect(rolRegel({ role: 'planner' })).toBe('Planner');
    expect(rolRegel({ role: 'admin' })).toBe('Beheerder');
  });

  it('de schakelaar telt alleen bij een chauffeur', () => {
    expect(rolRegel({ role: 'planner', ookTechnieker: true })).toBe('Planner');
    expect(rolRegel({ role: 'admin', ookTechnieker: true })).toBe('Beheerder');
    expect(rolRegel({ role: 'technieker', ookTechnieker: true })).toBe('Technieker');
  });
});

describe('het rolfilter', () => {
  it('Alles, dan de vier rollen in de volgorde van ROLLEN, met de labels uit dezelfde bron', () => {
    expect(ROL_FILTER).toEqual([
      { waarde: 'all', label: 'Alles' },
      { waarde: 'chauffeur', label: 'Chauffeur' },
      { waarde: 'technieker', label: 'Technieker' },
      { waarde: 'planner', label: 'Planner' },
      { waarde: 'admin', label: 'Beheerder' },
    ]);
    for (const rol of ROLLEN) expect(ROL_FILTER.find((o) => o.waarde === rol)?.label).toBe(ROL_LABEL[rol]);
  });

  const MENSEN = [
    { id: 'c', role: 'chauffeur' },
    { id: 'c+t', role: 'chauffeur', ookTechnieker: true },
    { id: 't', role: 'technieker' },
    { id: 'p', role: 'planner' },
    { id: 'a', role: 'admin' },
  ];
  const onder = (filter: Parameters<typeof pastBijRolFilter>[1]) => MENSEN.filter((m) => pastBijRolFilter(m, filter)).map((m) => m.id);

  it('Alles toont iedereen', () => {
    expect(onder('all')).toEqual(['c', 'c+t', 't', 'p', 'a']);
  });

  it('Planner en Beheerder filteren op de rol, zoals voorheen', () => {
    expect(onder('planner')).toEqual(['p']);
    expect(onder('admin')).toEqual(['a']);
  });

  it('Chauffeur toont elke chauffeur, ook wie "Ook technieker" aan heeft (role is de maat voor wie iemand is)', () => {
    expect(onder('chauffeur')).toEqual(['c', 'c+t']);
  });

  it('Technieker toont de techniekers én de chauffeur met "Ook technieker"', () => {
    expect(onder('technieker')).toEqual(['c+t', 't']);
  });

  it('de schakelaar op een planner of admin brengt hem niet onder Technieker', () => {
    expect(pastBijRolFilter({ role: 'planner', ookTechnieker: true }, 'technieker')).toBe(false);
    expect(pastBijRolFilter({ role: 'admin', ookTechnieker: true }, 'technieker')).toBe(false);
  });
});

describe('open punt: de personeelsrapporten', () => {
  it('houden voorlopig "Planning" en "Beheer", want dezelfde waarde staat in de CSV-export', () => {
    expect(ROL_IN_RAPPORT).toEqual({ chauffeur: 'Chauffeur', technieker: 'Technieker', planner: 'Planning', admin: 'Beheer' });
  });
});
