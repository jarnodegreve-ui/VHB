import { describe, it, expect } from 'vitest';
import { applySwapsToPlanningRows, swapRaaktBereik } from '../api/_lib/storage.js';

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
    expect(res).toEqual({ applied: 1, skipped: 0, alVerwerkt: 0, opBord: 0, nietToepasbaar: [] });
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
    expect(res).toEqual({ applied: 0, skipped: 2, alVerwerkt: 0, opBord: 0, nietToepasbaar: [] });
    expect(r.every((row, i) => row.driverId === rows()[i].driverId)).toBe(true);
  });

  it('past ruilen in volgorde toe: een latere ruil werkt op het resultaat van een eerdere', () => {
    const r = [{ date: '2026-07-08', line: '12', driverId: '3' }];
    const res = applySwapsToPlanningRows(r, [
      { requesterId: '3', targetDriverId: '4', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12' },
      { requesterId: '4', targetDriverId: '5', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12' },
    ]);
    expect(res).toEqual({ applied: 2, skipped: 0, alVerwerkt: 0, opBord: 0, nietToepasbaar: [] });
    expect(r[0].driverId).toBe('5');
  });

  it("telt een ruil die de planner al in de Excel verwerkte als 'al verwerkt', niet als 'niet toepasbaar'", () => {
    // De matrix zet de dienst al op de collega: er valt niets te verhuizen,
    // maar het is ook geen mismatch (bevinding Jarno 12-09).
    const r = [{ date: '2026-07-08', line: '12', driverId: '4' }];
    const res = applySwapsToPlanningRows(r, [{
      requesterId: '3', targetDriverId: '4', swapType: 'overname', shiftDate: '2026-07-08', shiftLine: '12',
    }]);
    expect(res).toEqual({ applied: 0, skipped: 0, alVerwerkt: 1, opBord: 0, nietToepasbaar: [] });
    expect(r[0].driverId).toBe('4');
  });

  it('een 1-op-1-ruil waarvan de Excel beide benen al kent, telt één keer als al verwerkt', () => {
    const r = [
      { date: '2026-07-08', line: '12', driverId: '4' },
      { date: '2026-07-02', line: '14', driverId: '3' },
    ];
    const res = applySwapsToPlanningRows(r, [{
      requesterId: '3', targetDriverId: '4', swapType: 'ruil',
      shiftDate: '2026-07-08', shiftLine: '12', returnDate: '2026-07-02', returnCode: '14',
    }]);
    expect(res).toEqual({ applied: 0, skipped: 0, alVerwerkt: 1, opBord: 0, nietToepasbaar: [] });
  });
});

/**
 * Code-diensten (schoolrit, bureau, garage) hebben geen rijen in de planning:
 * het bord legt de wissel erover. De replay mag ze niet als "niet toepasbaar"
 * melden, want dat woord hoort een échte mismatch te betekenen.
 */
describe('applySwapsToPlanningRows, code-diensten', () => {
  const isCodeDienst = (line: unknown) => String(line ?? '').toLowerCase().startsWith('eek');
  const rijen = () => [{ date: '2026-09-28', line: '2105', driverId: '4' }];

  it('telt een wissel van een schoolrit apart, niet als overgeslagen', () => {
    const res = applySwapsToPlanningRows(rijen(), [{
      requesterId: '3', targetDriverId: '4', swapType: 'overname',
      shiftDate: '2026-09-28', shiftLine: 'EEK6',
    }], isCodeDienst);
    expect(res).toEqual({ applied: 0, skipped: 0, alVerwerkt: 0, opBord: 1, nietToepasbaar: [] });
  });

  it('zonder toets blijft het gedrag van vroeger: overgeslagen', () => {
    const res = applySwapsToPlanningRows(rijen(), [{
      requesterId: '3', targetDriverId: '4', swapType: 'overname',
      shiftDate: '2026-09-28', shiftLine: 'EEK6',
    }]);
    // Zonder toets is dit een gewone mismatch: B heeft EEK6 niet, niemand heeft hem.
    expect(res).toEqual({ applied: 0, skipped: 1, alVerwerkt: 0, opBord: 0, nietToepasbaar: [{ ruil: expect.objectContaining({ shiftLine: 'EEK6' }), been: 'aangeboden', dienstBij: [] }] });
  });

  it('een gemengde 1-op-1 verhuist de dienst met rijen en telt als doorgevoerd', () => {
    const r = rijen();
    const res = applySwapsToPlanningRows(r, [{
      requesterId: '3', targetDriverId: '4', swapType: 'ruil',
      shiftDate: '2026-09-28', shiftLine: 'EEK6', returnDate: '2026-09-28', returnCode: '2105',
    }], isCodeDienst);
    expect(res).toEqual({ applied: 1, skipped: 0, alVerwerkt: 0, opBord: 0, nietToepasbaar: [] });
    expect(r[0].driverId).toBe('3');
  });

  it('een gemengde 1-op-1 waarvan de dienst met rijen zoek is, blijft een mismatch', () => {
    const res = applySwapsToPlanningRows([], [{
      requesterId: '3', targetDriverId: '4', swapType: 'ruil',
      shiftDate: '2026-09-28', shiftLine: 'EEK6', returnDate: '2026-09-28', returnCode: '2105',
    }], isCodeDienst);
    expect(res).toEqual({ applied: 0, skipped: 1, alVerwerkt: 0, opBord: 0, nietToepasbaar: [] });
  });
});

/**
 * De gemiste ruilen bij naam (06-11): een handmatige wissel (Bianca → Roeland,
 * dienst 2101) werd twee minuten later overschreven door een Excel-import die
 * de dienst bij een derde had. De replay telde hem stil als "niet toepasbaar";
 * nu zegt hij wélke ruil en bij wie de dienst dan staat, getoetst op het
 * eindbeeld (een ketting die de dienst alsnog bij de ontvanger brengt, is
 * geen probleem).
 */
describe('applySwapsToPlanningRows, gemiste ruilen bij naam (06-11)', () => {
  const DAG = '2026-11-16';
  const biancaNaarRoeland = { requesterId: '3', targetDriverId: '4', swapType: 'overname' as const, shiftDate: DAG, shiftLine: '2101' };

  it('de dienst staat in de Excel bij een derde: de ruil wordt genoemd, met die derde erbij', () => {
    const rijen = [{ date: DAG, line: '2101', driverId: '7' }, { date: DAG, line: '2101', driverId: '7' }];
    const res = applySwapsToPlanningRows(rijen, [biancaNaarRoeland]);
    expect(res).toEqual({ applied: 0, skipped: 1, alVerwerkt: 0, opBord: 0, nietToepasbaar: [{ ruil: biancaNaarRoeland, been: 'aangeboden', dienstBij: ['7'] }] });
    expect(rijen.every((r) => r.driverId === '7')).toBe(true);
  });

  it('de dienst staat die dag bij niemand in de Excel: genoemd, zonder derde', () => {
    const res = applySwapsToPlanningRows([{ date: DAG, line: '14', driverId: '7' }], [biancaNaarRoeland]);
    expect(res.nietToepasbaar).toEqual([{ ruil: biancaNaarRoeland, been: 'aangeboden', dienstBij: [] }]);
  });

  it('een latere ruil brengt de dienst alsnog bij de ontvanger: overgeslagen, maar niets te melden', () => {
    const rijen = [{ date: DAG, line: '2101', driverId: '7' }];
    const res = applySwapsToPlanningRows(rijen, [
      biancaNaarRoeland,
      { requesterId: '7', targetDriverId: '4', swapType: 'overname' as const, shiftDate: DAG, shiftLine: '2101' },
    ]);
    expect(res).toEqual({ applied: 1, skipped: 1, alVerwerkt: 0, opBord: 0, nietToepasbaar: [] });
    expect(rijen[0].driverId).toBe('4');
  });

  it('ketting A naar B, daarna B naar C, de Excel al bij C: de laatste schakel beslist, niets te melden', () => {
    const rijen = [{ date: DAG, line: '2101', driverId: '7' }];
    const res = applySwapsToPlanningRows(rijen, [
      biancaNaarRoeland,
      { requesterId: '4', targetDriverId: '7', swapType: 'overname' as const, shiftDate: DAG, shiftLine: '2101' },
    ]);
    expect(res).toEqual({ applied: 0, skipped: 1, alVerwerkt: 1, opBord: 0, nietToepasbaar: [] });
  });

  it('ketting waarvan de laatste schakel niet klopt: alleen die schakel wordt genoemd', () => {
    const doorgeven = { requesterId: '4', targetDriverId: '8', swapType: 'overname' as const, shiftDate: DAG, shiftLine: '2101' };
    const res = applySwapsToPlanningRows([{ date: DAG, line: '2101', driverId: '7' }], [biancaNaarRoeland, doorgeven]);
    expect(res.nietToepasbaar).toEqual([{ ruil: doorgeven, been: 'aangeboden', dienstBij: ['7'] }]);
  });

  it('1-op-1 op één dag: het terugbeen komt terug, het aangeboden been staat bij een derde: dat been wordt genoemd', () => {
    const ruil = { ...biancaNaarRoeland, swapType: 'ruil' as const, returnDate: DAG, returnCode: '14' };
    const rijen = [{ date: DAG, line: '2101', driverId: '7' }, { date: DAG, line: '14', driverId: '4' }];
    const res = applySwapsToPlanningRows(rijen, [ruil]);
    // Telt als doorgevoerd (het terugbeen verhuisde), maar 2101 staat bij 7.
    expect(res).toEqual({ applied: 1, skipped: 0, alVerwerkt: 0, opBord: 0, nietToepasbaar: [{ ruil, been: 'aangeboden', dienstBij: ['7'] }] });
    expect(rijen[1].driverId).toBe('3');
  });

  it('1-op-1: het aangeboden been staat al bij de ontvanger, de terugdienst bij een derde: het terugbeen wordt genoemd', () => {
    const ruil = { ...biancaNaarRoeland, swapType: 'ruil' as const, returnDate: DAG, returnCode: '14' };
    const res = applySwapsToPlanningRows([{ date: DAG, line: '2101', driverId: '4' }, { date: DAG, line: '14', driverId: '9' }], [ruil]);
    expect(res).toEqual({ applied: 0, skipped: 0, alVerwerkt: 1, opBord: 0, nietToepasbaar: [{ ruil, been: 'terug', dienstBij: ['9'] }] });
  });

  it('een been dat een code-dienst is, wordt nooit op rijen getoetst; het andere been wel', () => {
    const isCode = (line: unknown) => String(line ?? '').toLowerCase().startsWith('eek');
    const ruil = { ...biancaNaarRoeland, swapType: 'ruil' as const, shiftLine: 'EEK6', returnDate: DAG, returnCode: '14' };
    const res = applySwapsToPlanningRows([{ date: DAG, line: '14', driverId: '9' }], [ruil], isCode);
    expect(res.nietToepasbaar).toEqual([{ ruil, been: 'terug', dienstBij: ['9'] }]);
  });

  it('een dag zonder enige rij (gat in de matrix) wordt niet gemeld', () => {
    const rijen = [{ date: '2026-11-10', line: '14', driverId: '7' }, { date: '2026-11-20', line: '14', driverId: '7' }];
    const res = applySwapsToPlanningRows(rijen, [biancaNaarRoeland]);
    expect(res.nietToepasbaar).toEqual([]);
  });

  it('een dag buiten de heropgebouwde rijen is niet "bij niemand": niets te melden', () => {
    const res = applySwapsToPlanningRows([{ date: '2026-12-01', line: '2101', driverId: '7' }], [biancaNaarRoeland]);
    expect(res).toEqual({ applied: 0, skipped: 1, alVerwerkt: 0, opBord: 0, nietToepasbaar: [] });
  });

  it('1-op-1 met de aangeboden dienst buiten de periode: het terugbeen wordt getoetst, bij de gever', () => {
    // Periode-import november: alleen de terugdienst (14 op 16/11) ligt erin,
    // en die staat in de Excel bij een derde in plaats van bij de gever.
    const ruil = { ...biancaNaarRoeland, swapType: 'ruil' as const, shiftDate: '2026-10-30', shiftLine: '12', returnDate: DAG, returnCode: '14' };
    const res = applySwapsToPlanningRows([{ date: DAG, line: '14', driverId: '9' }], [ruil]);
    expect(res.nietToepasbaar).toEqual([{ ruil, been: 'terug', dienstBij: ['9'] }]);
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
    expect(res).toEqual({ applied: 1, skipped: 0, alVerwerkt: 0, opBord: 0, nietToepasbaar: [] });
    expect(rijen[0].driverId).toBe('3');
  });
});
