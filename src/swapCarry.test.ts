import { describe, it, expect } from 'vitest';
import { applySwapsToPlanningRows, swapRaaktBereik } from '../api/storage.js';

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

/**
 * Periode-import: welke goedgekeurde ruilen horen bij een heropbouw van
 * [van, tot]? Beide benen tellen — het terugbeen van een maandoverschrijdende
 * 1-op-1-ruil viel er vroeger stil uit (controle-ronde 27-08, bevinding 7).
 */
describe('swapRaaktBereik (periode-import)', () => {
  const september = { van: '2026-09-01', tot: '2026-09-30' };
  const ruil = (extra: Record<string, unknown>) => ({
    requesterId: '3', targetDriverId: '4', swapType: 'ruil' as const,
    shiftDate: '2026-08-30', shiftLine: '12', returnDate: '2026-09-03', returnCode: '14',
    ...extra,
  });

  it('telt het terugbeen van een maandoverschrijdende 1-op-1-ruil mee', () => {
    expect(swapRaaktBereik(ruil({}), september)).toBe(true);
  });

  it('laat een ruil die volledig vóór het bereik ligt weg', () => {
    expect(swapRaaktBereik(ruil({ returnDate: '2026-08-31' }), september)).toBe(false);
  });

  it('bij een overname of een vrije dag als tegenprestatie telt alleen de aangeboden dienst', () => {
    expect(swapRaaktBereik(ruil({ swapType: 'overname' }), september)).toBe(false);
    expect(swapRaaktBereik(ruil({ returnCode: 'VRIJ' }), september)).toBe(false);
    expect(swapRaaktBereik(ruil({ swapType: 'overname', shiftDate: '2026-09-10' }), september)).toBe(true);
  });

  it('een legacy-ruil zonder shiftDate blijft relevant (de replay telt hem als niet-toepasbaar)', () => {
    expect(swapRaaktBereik(ruil({ shiftDate: undefined, returnDate: '2026-08-31' }), september)).toBe(true);
  });

  it('de replay past bij zo\'n ruil alleen het been binnen de heropgebouwde rijen toe', () => {
    // Alleen september-rijen (periode-import): de terugdienst staat vers op de collega.
    const rijen = [{ date: '2026-09-03', line: '14', driverId: '4' }];
    const res = applySwapsToPlanningRows(rijen, [ruil({})]);
    expect(res).toEqual({ applied: 1, skipped: 0 });
    expect(rijen[0].driverId).toBe('3');
  });
});
