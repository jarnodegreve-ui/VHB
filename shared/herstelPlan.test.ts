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

  // Regressie 01-10: de export van de planningscodes heeft geen id, de code is
  // de sleutel van de tabel. De droge run nam overal een id aan en blokkeerde
  // daardoor elke back-up ("18 records zonder id"), en dus ook elk echt herstel.
  describe('planningscodes', () => {
    const code = (c: string) => ({ code: c, category: 'leave', description: '', countsAsShift: false, isPaidAbsence: false, isDayOff: false });

    it('worden herkend aan hun code, niet aan een id', () => {
      const plan = bouwHerstelPlan({
        backup: { users: [admin], planningCodes: [code('bv'), code('tk'), code('ov')] },
        live: { users: [admin], planningCodes: [code('bv'), code('tk'), code('ziek')] },
        exportedAt: '2026-09-21T02:00:00Z',
        nu: NU,
      });
      expect(plan.blokkades).toEqual([]);
      expect(regel(plan, 'planningCodes')).toMatchObject({ backup: 3, live: 3, erbij: 1, weg: 1, blijft: 2 });
    });

    it('zonder code of met een dubbele code blokkeren, zoals het herstel ze leest: in kleine letters', () => {
      const plan = bouwHerstelPlan({
        backup: { users: [admin], planningCodes: [code('bv'), code(' BV '), code(''), { id: 'x' }] },
        live: {},
        exportedAt: '2026-09-21T02:00:00Z',
        nu: NU,
      });
      expect(plan.blokkades).toEqual([
        "'planningCodes': 2 records zonder code",
        "'planningCodes': 1 dubbele code (bv)",
      ]);
    });
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

  it('blokkeert als een huidige dienstregelingversie de begindatum van een andere versie uit de back-up draagt (16-10)', () => {
    const versie = (id: string, geldigVanaf: string) => ({ id, naam: null, geldigVanaf });
    const plan = (backupVersies: unknown[], liveVersies: unknown[]) => bouwHerstelPlan({
      backup: { users: [admin], dienstregelingen: backupVersies },
      live: { users: [admin], dienstregelingen: liveVersies },
      exportedAt: '2026-09-21T02:00:00Z',
      nu: NU,
    });
    const melding = (data: string) => `'dienstregelingen': een huidige versie draagt de begindatum van een andere versie uit de back-up (${data}); verplaats of verwijder eerst die huidige versie`;
    // Zelfde stand, of alleen een versie erbij of weg: geen botsing.
    expect(plan([versie('a', '2026-09-01'), versie('b', '2026-11-14')], [versie('a', '2026-09-01'), versie('b', '2026-11-14')]).blokkades).toEqual([]);
    expect(plan([versie('a', '2026-09-01')], [versie('a', '2026-09-01'), versie('b', '2026-11-14')]).blokkades).toEqual([]);
    expect(plan([versie('a', '2026-09-01'), versie('b', '2026-11-14')], [versie('a', '2026-09-01')]).blokkades).toEqual([]);
    // Een versie die alleen van datum veranderde, botst met niemand: de upsert op id zet ze terug.
    expect(plan([versie('b', '2026-11-14')], [versie('b', '2026-11-21')]).blokkades).toEqual([]);
    // Verschoven: B ging van 14/11 naar 21/11 en C kwam op 14/11.
    expect(plan([versie('a', '2026-09-01'), versie('b', '2026-11-14')], [versie('a', '2026-09-01'), versie('b', '2026-11-21'), versie('c', '2026-11-14')]).blokkades)
      .toEqual([melding('14/11/2026')]);
    // Gewisseld: B en C ruilden van datum.
    expect(plan([versie('b', '2026-11-14'), versie('c', '2026-11-21')], [versie('b', '2026-11-21'), versie('c', '2026-11-14')]).blokkades)
      .toEqual([melding('14/11/2026, 21/11/2026')]);
    // Opnieuw gemaakt: dezelfde datum, een nieuw id.
    expect(plan([versie('b', '2026-11-14')], [versie('b2', '2026-11-14')]).blokkades).toEqual([melding('14/11/2026')]);
    // Een back-up zonder versies (van vóór 08-10) laat ze ongemoeid en botst dus nooit.
    expect(bouwHerstelPlan({ backup: { users: [admin] }, live: { users: [admin], dienstregelingen: [versie('c', '2026-11-14')] }, exportedAt: '2026-09-21T02:00:00Z', nu: NU }).blokkades).toEqual([]);
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
