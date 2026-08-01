import { describe, it, expect } from 'vitest';
import { applySwapsToPlanningRows } from '../api/storage.js';

/**
 * Pure heropbouw-replay: goedgekeurde ruilen opnieuw toepassen op vers
 * gegenereerde planning-rijen. Dit is de functie die voorkomt dat een
 * matrix-import/heropbouw alle doorgevoerde wissels weer wegveegt.
 */
describe('applySwapsToPlanningRows', () => {
  const rows = () => [
    { date: '2026-07-08', line: '12', driverId: '3' },
    { date: '2026-07-08', line: '12', driverId: '3' }, // tweede segment zelfde dienst
    { date: '2026-07-02', line: '14', driverId: '4' },
    { date: '2026-07-02', line: '15', driverId: '5' },
  ];

  it('verhuist alle segmenten van de aangeboden dienst (overname)', () => {
    const r = rows();
    const res = applySwapsToPlanningRows(r, [{
      requesterId: '3', targetDriverId: '4', swapType: 'overname',
      shiftDate: '2026-07-08', shiftLine: '12',
    }]);
    expect(res).toEqual({ applied: 1, skipped: 0 });
    expect(r[0].driverId).toBe('4');
    expect(r[1].driverId).toBe('4');
    expect(r[2].driverId).toBe('4'); // onaangeraakt
  });

  it('verhuist bij een 1-op-1 ruil ook de terugdienst', () => {
    const r = rows();
    applySwapsToPlanningRows(r, [{
      requesterId: '3', targetDriverId: '4', swapType: 'ruil',
      shiftDate: '2026-07-08', shiftLine: '12',
      returnDate: '2026-07-02', returnCode: '14',
    }]);
    expect(r[0].driverId).toBe('4');
    expect(r[2].driverId).toBe('3');
    expect(r[3].driverId).toBe('5'); // andere dienst blijft staan
  });

  it("een 'vrij'-tegenprestatie verhuist niets terug", () => {
    const r = rows();
    applySwapsToPlanningRows(r, [{
      requesterId: '3', targetDriverId: '4', swapType: 'ruil',
      shiftDate: '2026-07-08', shiftLine: '12',
      returnDate: '2026-07-05', returnCode: 'vrij',
    }]);
    expect(r[0].driverId).toBe('4');
    expect(r[2].driverId).toBe('4');
  });

  it('telt een ruil zonder dienst-info of zonder matchende rijen als skipped', () => {
    const r = rows();
    const res = applySwapsToPlanningRows(r, [
      { requesterId: '3', targetDriverId: '4', swapType: 'ruil' }, // legacy: geen shiftDate/shiftLine
      { requesterId: '3', targetDriverId: '4', swapType: 'overname', shiftDate: '2099-01-01', shiftLine: '99' },
    ]);
    expect(res).toEqual({ applied: 0, skipped: 2 });
    expect(r.every((row, i) => row.driverId === rows()[i].driverId)).toBe(true);
  });

  it('past ruilen in volgorde toe: een latere ruil werkt op het resultaat van een eerdere', () => {
    const r = [{ date: '2026-07-08', line: '12', driverId: '3' }];
    const res = applySwapsToPlanningRows(r, [
      { requesterId: '3', targetDriverId: '4', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12' },
      { requesterId: '4', targetDriverId: '5', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12' },
    ]);
    expect(res).toEqual({ applied: 2, skipped: 0 });
    expect(r[0].driverId).toBe('5');
  });
});
