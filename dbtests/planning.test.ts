/**
 * Planning vervangen is alles of niets. De drie databasefuncties
 * (replace_planning, replace_planning_matrix_rows,
 * replace_planning_and_matrix_periode) wissen en schrijven in één transactie:
 * faalt één rij, dan staat de oude planning er nog. Met een nagebootste
 * opslaglaag is dat niet te bewijzen, hier wel.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../api/db';
import { getPlanningData, getPlanningMatrixRows, replacePlanningAndMatrix, replacePlanningData } from '../api/storage';
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
