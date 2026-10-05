/**
 * Back-up en herstel als rondreis, met de echte opslaglaag en de echte
 * database: bouw een stand op, neem een back-up zoals de nachtcron dat doet,
 * verniel de stand, herstel, en vergelijk. Herstel was van 21-09 tot 01-10
 * geblokkeerd zonder dat één test het zag; dit is de test die het ziet.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { buildBackupPayload } from '../api/_lib/cronRoutes';
import { bouwHerstelPlan } from '../shared/herstelPlan';
import {
  checkBackupIntegrity, replacePlanningAndMatrix, restoreFromBackup, saveDiversionsData, saveLeaveData,
  savePlanningCodesData, saveServicesData, saveUpdatesData, saveUsersData, voegSwapsToe,
} from '../api/storage';
import { db } from '../api/db';
import { dienst, gebruiker, leegDatabase, matrixRij } from './hulp';

beforeEach(leegDatabase);

const bouwStand = async () => {
  await saveUsersData([
    gebruiker('adm', 'admin', 'Ada Admin'),
    gebruiker('pl1', 'planner', 'Piet Planner'),
    gebruiker('c1', 'chauffeur', 'Carl Een'),
    gebruiker('c2', 'chauffeur', 'Cas Twee'),
  ] as any);
  await saveServicesData([
    { id: 'sv1', serviceNumber: '2501', startTime: '06:00', endTime: '14:00', loopnr: 'L1' },
    { id: 'sv2', serviceNumber: '2502', startTime: '05:00', endTime: '09:00', startTime2: '15:00', endTime2: '19:00', loopnr: 'L2', loopnr2: 'L3' },
  ]);
  await savePlanningCodesData([
    { code: 'bv', category: 'leave', description: 'Betaald verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: true },
    { code: 'opl', category: 'training', description: 'Opleiding', countsAsShift: true, isPaidAbsence: false, isDayOff: false },
  ] as any);
  await replacePlanningAndMatrix(
    [matrixRij('2026-11-10', { c1: '2501', c2: 'bv' }), matrixRij('2026-11-11', { c1: 'opl', c2: '2502' })],
    [
      dienst({ id: 'p1', date: '2026-11-10', line: '2501', driverId: 'c1', loopnr: 'L1' }),
      dienst({ id: 'p2', date: '2026-11-11', line: '2502', driverId: 'c2', loopnr: 'L2' }),
    ],
  );
  await saveLeaveData([
    { id: 'v1', userId: 'c2', startDate: '2026-11-10', endDate: '2026-11-10', type: 'verlof', status: 'approved', comment: '', createdAt: '2026-10-01T08:00:00.000Z', decidedAt: '2026-10-02T08:00:00.000Z' },
    { id: 'v2', userId: 'c1', startDate: '2026-12-01', endDate: '2026-12-05', type: 'verlof', status: 'rejected', comment: 'Skiën', createdAt: '2026-10-03T08:00:00.000Z', decidedAt: '2026-10-04T08:00:00.000Z', beslisReden: 'Te veel afwezigen' },
  ]);
  await voegSwapsToe([
    { id: 'r1', shiftId: 'p1', requesterId: 'c1', targetDriverId: 'c2', status: 'pending', createdAt: '2026-11-01T08:00:00.000Z', reason: 'Tandarts', swapType: 'overname', shiftDate: '2026-11-10', shiftLine: '2501' },
  ]);
  await saveDiversionsData([
    { id: 'o1', line: '27', title: 'Werken Dorpsstraat', description: 'Halte vervalt', startDate: '2026-11-01', endDate: '2026-11-30', location: 'Aalst' },
  ]);
  await saveUpdatesData([
    { id: 'u1', date: '2026-11-01', title: 'Nieuwe uurregeling', content: 'Vanaf maandag.', category: 'algemeen' },
  ]);
};

/** Alles wat een herstel hoort terug te zetten, zonder wat per definitie beweegt. */
const stand = async () => {
  const { collections } = await buildBackupPayload();
  const { activityLog: _log, ...rest } = collections;
  return JSON.parse(JSON.stringify(rest));
};

describe('back-up en herstel', () => {
  it('de back-up van een gevulde stand is structureel in orde', async () => {
    await bouwStand();
    const payload = await buildBackupPayload();
    expect(checkBackupIntegrity(payload)).toEqual({ ok: true, issues: [] });
    expect(payload.collections.users).toHaveLength(4);
    expect(payload.authUsers).toHaveLength(4);
  });

  it('het herstelplan van de eigen back-up heeft geen blokkades', async () => {
    await bouwStand();
    const payload = JSON.parse(JSON.stringify(await buildBackupPayload()));
    const plan = bouwHerstelPlan({ backup: payload.collections, live: payload.collections, exportedAt: payload.exportedAt, actorId: 'adm' });
    expect(plan.blokkades).toEqual([]);
  });

  it('herstel zet een vernielde stand exact terug', async () => {
    await bouwStand();
    const voor = await stand();
    const backup = JSON.parse(JSON.stringify((await buildBackupPayload()).collections));

    // Vernielen: rijen weg, rijen gewijzigd, rijen erbij.
    await db!.from('planning').delete().eq('id', 'p1');
    await db!.from('planning').insert(dienst({ id: 'vreemd', date: '2026-11-20', line: '2599', driverId: 'c1' }));
    await db!.from('leave').delete().eq('id', 'v1');
    await db!.from('leave').update({ status: 'approved' }).eq('id', 'v2');
    await db!.from('swaps').update({ status: 'approved' }).eq('id', 'r1');
    await db!.from('services').delete().eq('id', 'sv2');
    await db!.from('planning_codes').delete().eq('code', 'opl');
    await db!.from('diversions').update({ title: 'Gewijzigd' }).eq('id', 'o1');
    await db!.from('updates').delete().eq('id', 'u1');
    await db!.from('planning_matrix_rows').delete().eq('source_date', '2026-11-11');
    await db!.from('users').update({ name: 'Verkeerde Naam' }).eq('id', 'c1');
    expect(await stand()).not.toEqual(voor);

    const samenvatting = await restoreFromBackup(backup);
    expect(samenvatting).toMatchObject({ users: 4, planning: 2, services: 2, leave: 2, swaps: 1, planningCodes: 2, planningMatrixRows: 2 });
    expect(await stand()).toEqual(voor);
  });

  it('herstel haalt een verwijderde gebruiker terug', async () => {
    await bouwStand();
    const voor = await stand();
    const backup = JSON.parse(JSON.stringify((await buildBackupPayload()).collections));
    await db!.from('users').delete().eq('id', 'c2');
    await restoreFromBackup(backup);
    const na = await stand();
    expect(na.users.map((u: any) => u.id).sort()).toEqual(['adm', 'c1', 'c2', 'pl1']);
    expect(na.planning).toEqual(voor.planning);
  });
});
