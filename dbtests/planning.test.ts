/**
 * Planning vervangen is alles of niets. De drie databasefuncties
 * (replace_planning, replace_planning_matrix_rows,
 * replace_planning_and_matrix_periode) wissen en schrijven in één transactie:
 * faalt één rij, dan staat de oude planning er nog. Met een nagebootste
 * opslaglaag is dat niet te bewijzen, hier wel.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../api/_lib/db';
import { getPlanningData, getPlanningHorizon, getPlanningMatrixGrenzen, getPlanningMatrixRows, replacePlanningAndMatrix, replacePlanningData, savePlanningCodesData } from '../api/_lib/storage';
import { dienst, leegDatabase, matrixRij, planningKort, planningVersie } from './hulp';

beforeEach(leegDatabase);

describe('replacePlanningData', () => {
  it('schrijft de set en leest ze ongewijzigd terug', async () => {
    const set = [
      dienst({ id: 'a', date: '2026-11-02', line: '2501', driverId: 'c1', busNumber: '4711', loopnr: 'L1' }),
      dienst({ id: 'b', date: '2026-11-02', line: '2502', driverId: 'c2', startTime: '22:00', endTime: '26:30' }),
    ];
    await replacePlanningData(set);
    const terug = (await getPlanningData()).sort((x: any, y: any) => x.id.localeCompare(y.id));
    expect(terug).toEqual(set);
  });

  it('vervangt alles: wat niet in de nieuwe set zit, is weg', async () => {
    await replacePlanningData([dienst({ id: 'oud', date: '2026-11-02', line: '2501', driverId: 'c1' })]);
    await replacePlanningData([dienst({ id: 'nieuw', date: '2026-11-03', line: '2502', driverId: 'c2' })]);
    expect(await planningKort()).toEqual(['2026-11-03 2502 c2']);
  });

  it('een ongeldige rij laat de oude planning volledig staan', async () => {
    await replacePlanningData([dienst({ id: 'oud', date: '2026-11-02', line: '2501', driverId: 'c1' })]);
    const kapot = [
      dienst({ id: 'x', date: '2026-11-03', line: '2502', driverId: 'c2' }),
      dienst({ id: 'x', date: '2026-11-04', line: '2503', driverId: 'c3' }),
    ];
    await expect(replacePlanningData(kapot)).rejects.toBeTruthy();
    expect(await planningKort()).toEqual(['2026-11-02 2501 c1']);
  });

  it('weigert een lege set', async () => {
    await replacePlanningData([dienst({ id: 'oud', date: '2026-11-02', line: '2501', driverId: 'c1' })]);
    await expect(replacePlanningData([])).rejects.toThrow(/Lege planning-set/);
    expect(await planningKort()).toEqual(['2026-11-02 2501 c1']);
  });

  it('hoogt planning_version op', async () => {
    const voor = await planningVersie();
    await replacePlanningData([dienst({ id: 'a', date: '2026-11-02', line: '2501', driverId: 'c1' })]);
    expect(await planningVersie()).toBeGreaterThan(voor);
  });
});

describe('replacePlanningAndMatrix (periode-import)', () => {
  const basis = async () => {
    await replacePlanningAndMatrix(
      [matrixRij('2026-10-30', { c1: '2501' }), matrixRij('2026-10-31', { c1: '2501' })],
      [
        dienst({ id: 'okt-30', date: '2026-10-30', line: '2501', driverId: 'c1' }),
        dienst({ id: 'okt-31', date: '2026-10-31', line: '2501', driverId: 'c1' }),
      ],
    );
  };

  it('vervangt alleen het bereik van het bestand, de rest blijft', async () => {
    await basis();
    await replacePlanningAndMatrix(
      [matrixRij('2026-11-01', { c2: '2502' }), matrixRij('2026-11-02', { c2: '2502' })],
      [dienst({ id: 'nov-01', date: '2026-11-01', line: '2502', driverId: 'c2' })],
    );
    expect(await planningKort()).toEqual(['2026-10-30 2501 c1', '2026-10-31 2501 c1', '2026-11-01 2502 c2']);
    expect((await getPlanningMatrixRows()).map((r) => r.source_date).sort()).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  });

  it('een nieuwe import van dezelfde periode overschrijft die periode', async () => {
    await basis();
    await replacePlanningAndMatrix(
      [matrixRij('2026-10-30', { c3: '2503' }), matrixRij('2026-10-31', { c3: 'vrij' })],
      [dienst({ id: 'okt-30-b', date: '2026-10-30', line: '2503', driverId: 'c3' })],
    );
    expect(await planningKort()).toEqual(['2026-10-30 2503 c3']);
    const matrix = await getPlanningMatrixRows();
    expect(matrix).toHaveLength(2);
    expect(matrix.find((r) => r.source_date === '2026-10-31')?.assignments).toEqual({ c3: 'vrij' });
  });

  it('een ongeldige dienst laat matrix én planning van die periode staan', async () => {
    await basis();
    const dubbel = [
      dienst({ id: 'zelfde', date: '2026-10-30', line: '2503', driverId: 'c3' }),
      dienst({ id: 'zelfde', date: '2026-10-31', line: '2503', driverId: 'c3' }),
    ];
    await expect(
      replacePlanningAndMatrix([matrixRij('2026-10-30', { c3: '2503' }), matrixRij('2026-10-31', { c3: '2503' })], dubbel),
    ).rejects.toBeTruthy();
    expect(await planningKort()).toEqual(['2026-10-30 2501 c1', '2026-10-31 2501 c1']);
    const { data } = await db!.from('planning_matrix_rows').select('assignments').order('source_date');
    expect(data).toEqual([{ assignments: { c1: '2501' } }, { assignments: { c1: '2501' } }]);
  });
});

/**
 * De grens van de planning (Jarno 22-11): de laatste matrixdag met minstens
 * één dienst. Lege dagen en dagen met alleen afwezigheid op het einde van de
 * matrix tellen niet. Hier de echte lezingen: de sortering op een datumkolom
 * en op de tekstkolom `planning.date`, het filter "na de laatste planningdag"
 * en de jsonb-cellen zoals PostgREST ze teruggeeft.
 */
describe('getPlanningHorizon en getPlanningMatrixGrenzen', () => {
  const code = (c: string, category: 'service' | 'absence' | 'leave') => ({
    code: c, category, description: c, countsAsShift: category === 'service', isPaidAbsence: category === 'leave', isDayOff: false,
  });
  // Elke test begint met een save van de planningscodes: die wist ook wat de
  // opslaglaag van een vorige test onthield.
  const codes = () => savePlanningCodesData([code('bv', 'leave'), code('ziek', 'absence'), code('eek1', 'service')]);
  const dagNa = (n: number) => new Date(Date.UTC(2027, 0, 3 + n)).toISOString().slice(0, 10);
  const beide = async () => ({ horizon: await getPlanningHorizon(), grenzen: await getPlanningMatrixGrenzen() });

  it('planning tot 03/01, lege rijen en afwezigheid tot 31/01: de grens is 03/01 voor rooster en maandplanning', async () => {
    await codes();
    const staart = Array.from({ length: 28 }, (_, i) => matrixRij(dagNa(i + 1), i % 3 === 0 ? {} : i % 3 === 1 ? { c1: '', c2: ' ' } : { c1: 'BV', c2: 'ziek' }));
    await replacePlanningAndMatrix(
      [matrixRij('2026-12-30', { c1: '2501' }), matrixRij('2027-01-03', { c1: '2501', c2: 'bv' }), ...staart],
      [
        dienst({ id: 'd-30', date: '2026-12-30', line: '2501', driverId: 'c1' }),
        dienst({ id: 'd-03', date: '2027-01-03', line: '2501', driverId: 'c1' }),
      ],
    );
    expect(await beide()).toEqual({ horizon: '2027-01-03', grenzen: { eerste: '2026-12-30', laatste: '2027-01-03' } });
  });

  it('een code-dienst zonder rijen in de planning na de laatste planningdag telt wel', async () => {
    await codes();
    await replacePlanningAndMatrix(
      [matrixRij('2027-01-03', { c1: '2501' }), matrixRij('2027-01-04', { c1: 'bv' }), matrixRij('2027-01-05', { c1: 'bv', c2: 'EEK1' }), matrixRij('2027-01-06', {})],
      [dienst({ id: 'd-03', date: '2027-01-03', line: '2501', driverId: 'c1' })],
    );
    expect(await beide()).toEqual({ horizon: '2027-01-05', grenzen: { eerste: '2027-01-03', laatste: '2027-01-05' } });
  });

  it('gewone toestand: op de laatste matrixdag staat een dienst', async () => {
    await codes();
    await replacePlanningAndMatrix(
      [matrixRij('2027-01-02', { c1: '2501' }), matrixRij('2027-01-03', { c1: '2501' })],
      [dienst({ id: 'd-02', date: '2027-01-02', line: '2501', driverId: 'c1' }), dienst({ id: 'd-03', date: '2027-01-03', line: '2501', driverId: 'c1' })],
    );
    expect(await beide()).toEqual({ horizon: '2027-01-03', grenzen: { eerste: '2027-01-02', laatste: '2027-01-03' } });
  });

  it('een staart langer dan één lezing wordt in stukken gelezen', async () => {
    await codes();
    // 50 dagen na de laatste planningdag, de schoolrit op dag 5: pas in de tweede lezing.
    const staart = Array.from({ length: 50 }, (_, i) => matrixRij(dagNa(i + 1), i === 4 ? { c2: 'eek1' } : { c1: 'bv' }));
    await replacePlanningAndMatrix(
      [matrixRij('2027-01-03', { c1: '2501' }), ...staart],
      [dienst({ id: 'd-03', date: '2027-01-03', line: '2501', driverId: 'c1' })],
    );
    expect((await beide()).horizon).toBe(dagNa(5));
  });

  it('een planningrij zonder datum telt niet als "geen planning"', async () => {
    await codes();
    await replacePlanningAndMatrix(
      [matrixRij('2027-01-03', { c1: '2501' }), matrixRij('2027-01-04', {})],
      [dienst({ id: 'd-03', date: '2027-01-03', line: '2501', driverId: 'c1' })],
    );
    const { error } = await db!.from('planning').insert({ id: 'zonder-datum', driverId: 'c1', line: '2501', startTime: '06:00', endTime: '14:00' });
    expect(error).toBeNull();
    expect(await beide()).toEqual({ horizon: '2027-01-03', grenzen: { eerste: '2027-01-03', laatste: '2027-01-03' } });
  });

  it('zonder matrix: de laatste opgebouwde dienst als horizon, geen grenzen; helemaal leeg: niets', async () => {
    await codes();
    expect(await beide()).toEqual({ horizon: null, grenzen: { eerste: null, laatste: null } });
    await replacePlanningData([dienst({ id: 'los', date: '2026-12-20', line: '2501', driverId: 'c1' })]);
    expect(await beide()).toEqual({ horizon: '2026-12-20', grenzen: { eerste: null, laatste: null } });
  });
});
