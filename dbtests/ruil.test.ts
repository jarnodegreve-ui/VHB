/**
 * Dienstruil tegen een echte database: de voorwaardelijke statuswissel
 * (compare-and-set), de insert die een bestaand id weigert, en het
 * doorvoeren en terugdraaien van een ruil in de planning.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applySwapToPlanning, getSwapsData, replacePlanningData, revertSwapFromPlanning,
  schrijfSwapAlsStatus, swapToestandInPlanning, voegSwapsToe,
} from '../api/storage';
import { dienst, leegDatabase, planningKort } from './hulp';

beforeEach(leegDatabase);

const ruil = {
  id: 'r1', shiftId: 's1', requesterId: 'c1', targetDriverId: 'c2', status: 'accepted' as const,
  createdAt: '2026-11-01T08:00:00.000Z', reason: 'Tandarts', swapType: 'ruil' as const,
  shiftDate: '2026-11-10', shiftLine: '2501', returnDate: '2026-11-12', returnCode: '2502',
};

describe('ruil opslaan', () => {
  it('leest terug wat er geschreven is, veld voor veld', async () => {
    await voegSwapsToe([ruil]);
    const [terug] = await getSwapsData();
    expect(terug).toMatchObject(ruil);
  });

  it('een tweede insert met hetzelfde id overschrijft niets', async () => {
    await voegSwapsToe([ruil]);
    await expect(voegSwapsToe([{ ...ruil, reason: 'Andere reden' }])).rejects.toMatchObject({ code: '23505' });
    expect((await getSwapsData())[0].reason).toBe('Tandarts');
  });

  it('statuswissel slaagt alleen vanaf de status die de handler las', async () => {
    await voegSwapsToe([ruil]);
    expect(await schrijfSwapAlsStatus({ ...ruil, status: 'approved', decidedAt: '2026-11-02T09:00:00.000Z' }, 'accepted')).toBe(true);
    // De chauffeur trok intussen in op basis van de oude stand: geen rij geraakt.
    expect(await schrijfSwapAlsStatus({ ...ruil, status: 'cancelled' }, 'accepted')).toBe(false);
    const [terug] = await getSwapsData();
    expect(terug.status).toBe('approved');
    expect(terug.decidedAt).toBe('2026-11-02T09:00:00.000Z');
  });
});

describe('ruil doorvoeren in de planning', () => {
  const planning = () => replacePlanningData([
    dienst({ id: 'a', date: '2026-11-10', line: '2501', driverId: 'c1' }),
    // Gesplitste dienst: twee rijen, één dienst.
    dienst({ id: 'a2', date: '2026-11-10', line: '2501', driverId: 'c1', startTime: '16:00', endTime: '19:00' }),
    dienst({ id: 'b', date: '2026-11-12', line: '2502', driverId: 'c2' }),
    dienst({ id: 'c', date: '2026-11-12', line: '2599', driverId: 'c3' }),
  ]);

  it('1-op-1: beide benen verhuizen, een derde blijft waar hij is', async () => {
    await planning();
    expect(await swapToestandInPlanning(ruil)).toBe('niet_doorgevoerd');
    expect(await applySwapToPlanning(ruil)).toEqual({ offeredMoved: 2, returnMoved: 1 });
    expect(await planningKort()).toEqual([
      '2026-11-10 2501 c2', '2026-11-10 2501 c2', '2026-11-12 2502 c1', '2026-11-12 2599 c3',
    ]);
    expect(await swapToestandInPlanning(ruil)).toBe('doorgevoerd');
  });

  it('een tweede keer doorvoeren verplaatst niets meer', async () => {
    await planning();
    await applySwapToPlanning(ruil);
    expect(await applySwapToPlanning(ruil)).toEqual({ offeredMoved: 0, returnMoved: 0 });
    expect(await swapToestandInPlanning(ruil)).toBe('doorgevoerd');
  });

  it('terugdraaien zet de planning exact terug', async () => {
    await planning();
    const voor = await planningKort();
    await applySwapToPlanning(ruil);
    expect(await revertSwapFromPlanning(ruil)).toEqual({ offeredMoved: 2, returnMoved: 1 });
    expect(await planningKort()).toEqual(voor);
  });

  it('overname: alleen de aangeboden dienst verhuist', async () => {
    await planning();
    const overname = { ...ruil, swapType: 'overname' as const, returnDate: undefined, returnCode: undefined };
    expect(await applySwapToPlanning(overname)).toEqual({ offeredMoved: 2, returnMoved: null });
    expect(await planningKort()).toContain('2026-11-12 2502 c2');
  });

  it('alleen het aangeboden been: de terugdienst blijft staan', async () => {
    await planning();
    expect(await applySwapToPlanning(ruil, { aangeboden: true, terug: false })).toEqual({ offeredMoved: 2, returnMoved: 0 });
    expect(await planningKort()).toContain('2026-11-12 2502 c2');
    // Half doorgevoerd is geen van beide eindstanden.
    expect(await swapToestandInPlanning(ruil)).toBe('onbekend');
  });
});
