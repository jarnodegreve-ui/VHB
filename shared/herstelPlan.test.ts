import { describe, expect, it } from 'vitest';
import { bouwHerstelPlan } from './herstelPlan';

const NU = new Date('2026-09-22T08:00:00Z');
const admin = { id: '1', name: 'Admin', role: 'admin' };
const rij = (id: string) => ({ id });
const regel = (plan: ReturnType<typeof bouwHerstelPlan>, collectie: string) => plan.regels.find((r) => r.collectie === collectie)!;

describe('bouwHerstelPlan', () => {
  it('telt per collectie wat erbij komt, verdwijnt en overschreven wordt', () => {
    const plan = bouwHerstelPlan({
      backup: { users: [admin, rij('2'), rij('3')], services: [rij('a')] },
      live: { users: [admin, rij('2'), rij('9')], services: [rij('a'), rij('b'), rij('c')] },
      exportedAt: '2026-09-21T02:00:00Z',
      nu: NU,
    });
    expect(regel(plan, 'users')).toMatchObject({ backup: 3, live: 3, erbij: 1, weg: 1, blijft: 2 });
    expect(regel(plan, 'services')).toMatchObject({ erbij: 0, weg: 2, blijft: 1 });
    expect(plan.blokkades).toEqual([]);
    expect(plan.waarschuwingen).toEqual(["'services': 2 van de 3 huidige records verdwijnen"]);
    expect(plan.totaalBackup).toBe(4);
  });

  it('een collectie die niet in de back-up zit blijft ongemoeid', () => {
    const plan = bouwHerstelPlan({ backup: { users: [admin] }, live: { users: [admin], swaps: [rij('s1')] }, exportedAt: '2026-09-21T02:00:00Z', nu: NU });
    expect(regel(plan, 'swaps')).toMatchObject({ inBackup: false, live: 1, weg: 0 });
  });

  it('een lege matrix wordt overgeslagen en wist dus niets', () => {
    const plan = bouwHerstelPlan({ backup: { users: [admin], planningMatrixRows: [] }, live: { users: [admin], planningMatrixRows: [rij('m1'), rij('m2')] }, exportedAt: '2026-09-21T02:00:00Z', nu: NU });
    expect(regel(plan, 'planningMatrixRows')).toMatchObject({ overgeslagen: true, weg: 0 });
    expect(plan.waarschuwingen).toEqual([]);
  });

  it('blokkeert op dubbele en ontbrekende id’s, een verkeerde vorm en een back-up zonder admin', () => {
    const plan = bouwHerstelPlan({
      backup: { users: [rij('2')], leave: [rij('l1'), rij('l1'), {}], planning: 'kapot', coverageExpectations: [] },
      live: {},
      exportedAt: '2026-09-21T02:00:00Z',
      nu: NU,
    });
    expect(plan.blokkades).toEqual([
      "'planning' is geen lijst",
      "'leave': 1 record zonder id",
      "'leave': 1 dubbele id (l1)",
      "'coverageExpectations' is geen object",
      'de back-up bevat geen admin-account',
    ]);
  });

  it('waarschuwt als de admin zelf niet in de back-up staat, en als de back-up oud of ongedateerd is', () => {
    const oud = bouwHerstelPlan({ backup: { users: [admin] }, live: { users: [admin] }, exportedAt: '2026-09-01T02:00:00Z', actorId: '7', nu: NU });
    expect(oud.waarschuwingen).toEqual([
      'jouw eigen account staat niet in deze back-up: na het herstel kan je niet meer aanmelden',
      'de back-up is 21 dagen oud: alles van daarna gaat verloren',
    ]);
    const zonderDatum = bouwHerstelPlan({ backup: { users: [admin] }, live: { users: [admin] }, exportedAt: 'x', actorId: '1', nu: NU });
    expect(zonderDatum.waarschuwingen).toEqual(['de back-up heeft geen geldige datum']);
    expect(zonderDatum.exportedAt).toBeNull();
  });

  it('dekkingsverwachting telt per dag-type', () => {
    const plan = bouwHerstelPlan({
      backup: { users: [admin], coverageExpectations: { week: ['2101'], zaterdag: [] } },
      live: { users: [admin], coverageExpectations: { week: ['2101'], zondag: [] } },
      exportedAt: '2026-09-21T02:00:00Z',
      nu: NU,
    });
    expect(regel(plan, 'coverageExpectations')).toMatchObject({ backup: 2, live: 2, erbij: 1, weg: 1, blijft: 1 });
  });
});
