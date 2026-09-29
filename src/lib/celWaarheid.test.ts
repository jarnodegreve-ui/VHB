import { describe, expect, it } from 'vitest';
import { berekenCelWaarheid } from '../../api/_lib/celWaarheid';

/**
 * Karakterisatietest van de cel-waarheid (fase B, 13-09): de logica is
 * ongewijzigd uit GET /api/month-planning gelicht. Vastgelegd: matrix met
 * naamresolutie in beide volgordes, dienst- en code-labels, een 1-op-1-ruil
 * die de Excel nog niet kende (cellen wisselen + merk), ziekte die een
 * dienst overdekt (hiddenService) en de bordvolgorde sectie → anciënniteit.
 */
const users = [
  { id: '1', name: 'Jan Janssen', role: 'chauffeur', isActive: true, section: 'Reguliere', startDate: '2010-01-01' },
  { id: '2', name: 'Peeters An', role: 'chauffeur', isActive: true, section: 'Nacht', startDate: '2012-01-01' },
  { id: '3', name: 'Piet Nieuw', role: 'chauffeur', isActive: true, section: 'Reguliere', startDate: '2020-01-01' },
  { id: '4', name: 'Els Planner', role: 'planner', isActive: true },
  { id: '5', name: 'Oud Weg', role: 'chauffeur', isActive: false },
];
const services = [{ serviceNumber: '2102', startTime: '05:28', endTime: '12:13', startTime2: '15:28', endTime2: '17:27', loopnr: '4600' }];
const codes = [{ code: 'bv', category: 'leave', description: 'Betaald verlof' }, { code: 'vrij', category: 'absence', description: 'Vrij' }, { code: 'ziek', category: 'absence', description: 'Ziek' }];
const rows = [
  { source_date: '2026-09-01', day_type: '21', assignments: { 'Jan Janssen': '2102', 'An Peeters': 'vrij', 'Piet Nieuw': 'bv' } },
  { source_date: '2026-09-02', day_type: '22', assignments: { 'Jan Janssen': 'vrij', 'An Peeters': '2102', 'Piet Nieuw': 'xx' } },
  { source_date: '2026-08-31', day_type: '21', assignments: { 'Jan Janssen': '2102' } },
];

describe('berekenCelWaarheid', () => {
  it('matrix → cellen met labels, bordvolgorde, alleen actieve chauffeurs', () => {
    const uit = berekenCelWaarheid('2026-09', { rows, users, services, codes, leave: [], swaps: [] });
    expect(uit.dates).toEqual(['2026-09-01', '2026-09-02']);
    expect(uit.chauffeurs.map((c) => c.name)).toEqual(['Jan Janssen', 'Piet Nieuw', 'Peeters An']);
    expect(uit.cells['1']['2026-09-01']).toEqual({ code: '2102', kind: 'service', label: 'Dienst 2102', segments: ['05:28–12:13 (loop 4600)', '15:28–17:27'] });
    expect(uit.cells['2']['2026-09-01']).toEqual({ code: 'vrij', kind: 'absence', label: 'Vrij', segments: [] });
    expect(uit.cells['3']['2026-09-02']).toEqual({ code: 'xx', kind: 'unknown', label: 'Onbekende code', segments: [] });
    expect(uit.cells['4']).toBeUndefined();
  });

  it('goedgekeurde ruil wisselt de cellen als de Excel hem nog niet kent', () => {
    const swaps = [{ id: 's1', requesterId: '1', targetDriverId: '2', status: 'approved', decidedAt: '2026-08-20T10:00:00Z', shiftDate: '2026-09-01', shiftLine: '2102', returnDate: '2026-09-02', returnCode: '2102', swapType: 'ruil', reason: '' }];
    const uit = berekenCelWaarheid('2026-09', { rows, users, services, codes, leave: [], swaps: swaps as any });
    expect(uit.cells['2']['2026-09-01']).toMatchObject({ code: '2102', swapId: 's1', swapFrom: 'Jan Janssen', swapManual: false });
    expect(uit.cells['1']['2026-09-01']).toMatchObject({ code: 'vrij' });
    expect(uit.cells['1']['2026-09-02']).toMatchObject({ code: '2102', swapId: 's1', swapFrom: 'Peeters An' });
    expect(uit.cells['2']['2026-09-02']).toMatchObject({ code: 'vrij' });
  });

  it('goedgekeurde ziekte overdekt de dienst en bewaart hem als hiddenService', () => {
    const leave = [
      { userId: '1', startDate: '2026-09-01', endDate: '2026-09-01', status: 'approved', type: 'ziekte' },
      { userId: '3', startDate: '2026-09-02', endDate: '2026-09-02', status: 'pending', type: 'betaald_verlof' },
      { userId: '2', startDate: '2026-09-03', endDate: '2026-09-01', status: 'approved', type: 'betaald_verlof' },
    ];
    const uit = berekenCelWaarheid('2026-09', { rows, users, services, codes, leave, swaps: [] });
    expect(uit.cells['1']['2026-09-01']).toEqual({ code: 'ziek', kind: 'absence', label: 'Ziek', segments: [], hiddenService: '2102' });
    expect(uit.cells['3']['2026-09-02'].code).toBe('xx');
    expect(uit.cells['2']['2026-09-02'].code).toBe('2102');
  });
});

/**
 * Een doorgevoerde wissel blijft gelden als de gever niet meer op het bord
 * staat (Jarno 29-09). Tot dan viel de hele ruil weg zodra één van beiden
 * uit dienst was: de ontvanger stond weer als vrij op het bord terwijl hij de
 * dienst nog reed, en kon er een tweede bij krijgen.
 */
describe('berekenCelWaarheid, een ruil met iemand die niet meer op het bord staat', () => {
  const mensen = [
    { id: '1', name: 'Jan Janssen', role: 'chauffeur', isActive: true, section: 'Reguliere', startDate: '2010-01-01' },
    { id: '2', name: 'Peeters An', role: 'chauffeur', isActive: true, section: 'Nacht', startDate: '2012-01-01' },
    { id: '5', name: 'Oud Weg', role: 'chauffeur', isActive: false },
  ];
  const matrix = [
    { source_date: '2026-09-01', day_type: '21', assignments: { 'Oud Weg': '2102', 'An Peeters': 'vrij', 'Jan Janssen': 'vrij' } },
    { source_date: '2026-09-02', day_type: '22', assignments: { 'Oud Weg': 'vrij', 'An Peeters': '2102' } },
  ];
  const ruil = (extra: Record<string, unknown> = {}) => ({ id: 's1', requesterId: '5', targetDriverId: '2', status: 'approved', decidedAt: '2026-08-20T10:00:00Z', shiftDate: '2026-09-01', shiftLine: '2102', swapType: 'overname', reason: '', ...extra });
  const bord = (swaps: unknown[], users = mensen) => berekenCelWaarheid('2026-09', { rows: matrix, users, services, codes, leave: [], swaps: swaps as never });

  it('wat de vertrokken gever weggaf blijft bij de ontvanger, met zijn naam erbij', () => {
    const uit = bord([ruil()]);
    expect(uit.cells['2']['2026-09-01']).toMatchObject({ code: '2102', kind: 'service', swapId: 's1', swapFrom: 'Oud Weg' });
  });

  it('de vertrokken gever zelf verschijnt niet op het bord', () => {
    const uit = bord([ruil()]);
    expect(uit.cells['5']).toBeUndefined();
    expect(uit.chauffeurs.map((c) => c.id)).toEqual(['1', '2']);
    // Ook zonder ruil staat zijn kolom er niet op.
    expect(bord([]).cells['5']).toBeUndefined();
  });

  it('1-op-1: ook het been naar de vertrokken gever geldt, de ontvanger houdt alleen wat hij kreeg', () => {
    const uit = bord([ruil({ swapType: 'ruil', returnDate: '2026-09-02', returnCode: '2102' })]);
    expect(uit.cells['2']['2026-09-01']).toMatchObject({ code: '2102', swapFrom: 'Oud Weg' });
    // De terugdienst staat in de planning op naam van de vertrokken gever: An
    // is die dag vrij (weggeruild), zoals toen Oud Weg nog in dienst was. Tot
    // optie A (Jarno 29-09) hield An hier ook 2102: twee diensten.
    expect(uit.cells['2']['2026-09-02']).toMatchObject({ code: 'vrij', swapId: 's1', swapAway: true, swapTo: 'Oud Weg' });
  });

  it('de ONTVANGER is vertrokken: de gever staat op vrij (weggeruild), zoals in de planning-rijen (open punt opgelost)', () => {
    // Jan gaf zijn dienst aan Oud Weg, die daarna uit dienst ging. Tot optie A
    // (Jarno 29-09) toonde het bord de dienst nog in de kolom van Jan.
    const rows = [{ source_date: '2026-09-01', day_type: '21', assignments: { 'Jan Janssen': '2102', 'Oud Weg': 'vrij' } }];
    const uit = berekenCelWaarheid('2026-09', { rows, users: mensen, services, codes, leave: [], swaps: [ruil({ requesterId: '1', targetDriverId: '5' })] as never });
    expect(uit.cells['1']['2026-09-01']).toEqual({ code: 'vrij', kind: 'absence', label: 'Vrij', segments: [], swapId: 's1', swapManual: false, swapDone: false, swapAway: true, swapTo: 'Oud Weg' });
    expect(uit.cells['5']).toBeUndefined();
  });

  it('1-op-1: wat de vertrokken collega teruggaf blijft bij de aanvrager', () => {
    // Jan gaf 2102 (01/09) aan Oud Weg en kreeg diens 2102 (02/09) terug.
    const rows = [
      { source_date: '2026-09-01', day_type: '21', assignments: { 'Jan Janssen': '2102', 'Oud Weg': 'vrij' } },
      { source_date: '2026-09-02', day_type: '22', assignments: { 'Jan Janssen': 'vrij', 'Oud Weg': '2102' } },
    ];
    const uit = berekenCelWaarheid('2026-09', { rows, users: mensen, services, codes, leave: [], swaps: [ruil({ requesterId: '1', targetDriverId: '5', swapType: 'ruil', returnDate: '2026-09-02', returnCode: '2102' })] as never });
    expect(uit.cells['1']['2026-09-02']).toMatchObject({ code: '2102', kind: 'service', swapFrom: 'Oud Weg' });
  });

  it('een kolom op naam van een chauffeur op het bord blijft van die chauffeur', () => {
    // Een oud, gepauzeerd account met dezelfde naam als een actieve chauffeur.
    const users = [...mensen.slice(0, 2), { id: '9', name: 'An Peeters', role: 'chauffeur', isActive: false }];
    const rows = [{ source_date: '2026-09-01', day_type: '21', assignments: { 'An Peeters': '2102', 'Jan Janssen': 'vrij' } }];
    const uit = berekenCelWaarheid('2026-09', { rows, users, services, codes, leave: [], swaps: [ruil({ requesterId: '9', targetDriverId: '1' })] as never });
    expect(uit.cells['2']['2026-09-01']).toMatchObject({ code: '2102' });
    expect(uit.cells['1']['2026-09-01']).toMatchObject({ code: 'vrij' });
    expect(uit.cells['1']['2026-09-01'].swapId).toBeUndefined();
  });

  it('een geannuleerde ruil van een vertrokken gever doet niets', () => {
    const uit = bord([ruil({ status: 'cancelled' })]);
    expect(uit.cells['2']['2026-09-01']).toEqual({ code: 'vrij', kind: 'absence', label: 'Vrij', segments: [] });
  });

  it('een gever met een andere rol (geen chauffeur) zonder kolom in de matrix: niets te verplaatsen', () => {
    const users = [...mensen, { id: '4', name: 'Els Planner', role: 'planner', isActive: true }];
    const uit = bord([ruil({ requesterId: '4' })], users);
    expect(uit.cells['2']['2026-09-01']).toEqual({ code: 'vrij', kind: 'absence', label: 'Vrij', segments: [] });
  });
});

/**
 * Optie A (Jarno 29-09): een collega die vertrok doet mee in een ruil als zijn
 * account bestaat, een van zijn naamsleutels over alle accounts eenduidig is
 * en zijn naam niet bij een chauffeur op het bord hoort; dan geldt elk been
 * waarvan de gever de dienst op zijn cel draagt. Voor wie op het bord staat is
 * het bord dan hetzelfde als toen hij nog in dienst was. De eerste versie van
 * 29-09 paste alleen het been VAN hem toe en telde zo bij een 1-op-1 over twee
 * dagen een dienst te veel. Doet hij niet mee, dan valt de ruil weg zoals
 * vroeger. De toets hangt niet af van de dagen die de aanroeper meegeeft: het
 * dagbord van de schrijfpaden en het maandbord tonen hetzelfde.
 */
describe('berekenCelWaarheid, optie A: beide benen, ook met wie vertrok', () => {
  const JAN = { id: '1', name: 'Jan Janssen', role: 'chauffeur', isActive: true, section: 'Reguliere', startDate: '2010-01-01' };
  const AN = { id: '2', name: 'Peeters An', role: 'chauffeur', isActive: true, section: 'Nacht', startDate: '2012-01-01' };
  const oudWeg = (isActive: boolean) => ({ id: '5', name: 'Oud Weg', role: 'chauffeur', isActive });
  const diensten = [...services, { serviceNumber: '2703', startTime: '22:00', endTime: '02:30' }];
  const rijen = [
    { source_date: '2026-09-01', day_type: '21', assignments: { 'Jan Janssen': '2102', 'An Peeters': 'vrij', 'Oud Weg': 'vrij' } },
    { source_date: '2026-09-02', day_type: '22', assignments: { 'Jan Janssen': 'vrij', 'An Peeters': 'vrij', 'Oud Weg': '2703' } },
  ];
  /** Met een dag waarop beiden rijden, voor een 1-op-1 op dezelfde dag. */
  const metDerdeDag = [...rijen, { source_date: '2026-09-03', day_type: '22', assignments: { 'Jan Janssen': '2102', 'An Peeters': 'vrij', 'Oud Weg': '2703' } }];
  /** Jan gaf 2102 (01/09) aan Oud Weg en kreeg diens 2703 (02/09) terug. */
  const ruil = (extra: Record<string, unknown> = {}) => ({
    id: 'r1', requesterId: '1', targetDriverId: '5', status: 'approved', decidedAt: '2026-08-20T10:00:00Z',
    shiftDate: '2026-09-01', shiftLine: '2102', swapType: 'ruil', returnDate: '2026-09-02', returnCode: '2703', reason: '', ...extra,
  });
  const bord = (swaps: unknown[], users: unknown[], rows: unknown[] = rijen) =>
    berekenCelWaarheid('2026-09', { rows: rows as never, users: users as never, services: diensten, codes, leave: [], swaps: swaps as never });
  const dienstenVan = (cellen: Record<string, { code: string; kind: string }> | undefined) =>
    Object.entries(cellen ?? {}).filter(([, c]) => c.kind === 'service').map(([dag, c]) => `${dag} ${c.code}`);
  const dienst2102 = { code: '2102', kind: 'service', label: 'Dienst 2102', segments: ['05:28–12:13 (loop 4600)', '15:28–17:27'] };

  it('1-op-1 over twee dagen, daarna vertrok de collega: Jan rijdt één dienst, op de juiste dag, zoals toen beiden in dienst waren', () => {
    const inDienst = bord([ruil()], [JAN, AN, oudWeg(true)]);
    const vertrokken = bord([ruil()], [JAN, AN, oudWeg(false)]);
    // Vóór 29-09: alleen 2102 op 01/09 (de verkeerde dag). Eerste versie van 29-09: 2102 én 2703.
    expect(dienstenVan(vertrokken.cells['1'])).toEqual(['2026-09-02 2703']);
    expect(vertrokken.cells['1']['2026-09-01']).toMatchObject({ code: 'vrij', swapId: 'r1', swapAway: true, swapTo: 'Oud Weg' });
    expect(vertrokken.cells['1']['2026-09-02']).toMatchObject({ code: '2703', swapId: 'r1', swapFrom: 'Oud Weg' });
    expect(vertrokken.cells['1']).toEqual(inDienst.cells['1']);
    expect(vertrokken.cells['5']).toBeUndefined();
    expect(vertrokken.chauffeurs.map((c) => c.id)).toEqual(['1', '2']);
  });

  it.each<[string, Record<string, unknown>, unknown[]?]>([
    ['een overname van hem', { requesterId: '5', targetDriverId: '2', shiftDate: '2026-09-02', shiftLine: '2703', swapType: 'overname', returnDate: undefined, returnCode: undefined }],
    ['een overname naar hem', { swapType: 'overname', returnDate: undefined, returnCode: undefined }],
    ['een 1-op-1 over twee dagen, hij vroeg', { requesterId: '5', targetDriverId: '1', shiftDate: '2026-09-02', shiftLine: '2703', returnDate: '2026-09-01', returnCode: '2102' }],
    ['een 1-op-1 over twee dagen, Jan vroeg', {}],
    ['een 1-op-1 op dezelfde dag', { shiftDate: '2026-09-03', returnDate: '2026-09-03' }, metDerdeDag],
    ['een afgehandelde ruil (completed)', { status: 'completed' }],
  ])('voor wie op het bord staat is het bord hetzelfde als toen hij nog in dienst was: %s', (_naam, extra, rows = rijen) => {
    const inDienst = bord([ruil(extra)], [JAN, AN, oudWeg(true)], rows);
    const vertrokken = bord([ruil(extra)], [JAN, AN, oudWeg(false)], rows);
    expect({ jan: vertrokken.cells['1'], an: vertrokken.cells['2'] }).toEqual({ jan: inDienst.cells['1'], an: inDienst.cells['2'] });
    expect(vertrokken.cells['5']).toBeUndefined();
  });

  it('een verwijderd account (geen user-record) als gever: de ruil doet niets, ook geen merk zonder naam', () => {
    // De Excel verwerkte de overname al: An staat op 2102.
    const rows = [{ source_date: '2026-09-01', day_type: '21', assignments: { 'Jan Janssen': 'vrij', 'An Peeters': '2102', 'Weg Account': 'vrij' } }];
    const uit = bord([ruil({ requesterId: 'weg-1', targetDriverId: '2', swapType: 'overname' })], [JAN, AN], rows);
    expect(uit.cells['2']['2026-09-01']).toEqual(dienst2102);
    expect(Object.keys(uit.cells).sort()).toEqual(['1', '2']);
  });

  it('een verwijderd account als ontvanger: de gever houdt zijn dienst, zoals vroeger (geen "weggeruild" zonder naam)', () => {
    const rows = [{ source_date: '2026-09-01', day_type: '21', assignments: { 'Jan Janssen': '2102', 'An Peeters': 'vrij' } }];
    const uit = bord([ruil({ targetDriverId: 'weg-1', swapType: 'overname' })], [JAN, AN], rows);
    expect(uit.cells['1']['2026-09-01']).toEqual(dienst2102);
    expect(Object.keys(uit.cells).sort()).toEqual(['1', '2']);
  });

  it('twee vertrokken accounts met botsende naam ("Oud Weg" en "Weg Oud"): geen kolom gaat naar de verkeerde, de ruil valt weg zoals vroeger', () => {
    const wegOud = { id: '7', name: 'Weg Oud', role: 'chauffeur', isActive: false };
    // Weg Oud gaf An op 02/09 dienst 2703. Die staat in de kolom "Oud Weg",
    // maar is niet van hem: de naamindex over alle accounts laat de botsende
    // sleutel vallen. Oud Weg zelf is daardoor niet eenduidig en doet niet
    // mee; Weg Oud wel, maar een kolom op zijn eigen naam heeft hij niet.
    const vanWegOud = { id: 'r7', requesterId: '7', targetDriverId: '2', status: 'approved', decidedAt: '2026-08-21T10:00:00Z', shiftDate: '2026-09-02', shiftLine: '2703', swapType: 'overname', reason: '' };
    const mensen = [JAN, AN, oudWeg(false), wegOud];
    const uit = bord([ruil(), vanWegOud], mensen);
    const zonderRuilen = bord([], mensen);
    expect(uit.cells['1']).toEqual(zonderRuilen.cells['1']);
    expect(uit.cells['2']).toEqual(zonderRuilen.cells['2']);
    expect(Object.keys(uit.cells).sort()).toEqual(['1', '2']);
    // Zonder de botsing geldt optie A gewoon.
    expect(dienstenVan(bord([ruil()], [JAN, AN, oudWeg(false)]).cells['1'])).toEqual(['2026-09-02 2703']);
  });

  it('beide partijen vertrokken: hun ruil raakt niemand op het bord, en geen van beiden verschijnt', () => {
    const els = { id: '8', name: 'Els Vertrokken', role: 'chauffeur', isActive: false };
    const rows = rijen.map((r) => ({ ...r, assignments: { ...r.assignments, 'Els Vertrokken': 'vrij' } }));
    // Oud Weg gaf Els op 02/09 dienst 2703. Beiden doen mee (bestaand account,
    // eenduidige naam), dus hun ruil telt, maar hun cellen gaan er daarna uit.
    // Hun ruilen van augustus met Jan vallen buiten deze maand.
    const tussenBeiden = { id: 'r8', requesterId: '5', targetDriverId: '8', status: 'approved', decidedAt: '2026-08-22T10:00:00Z', shiftDate: '2026-09-02', shiftLine: '2703', swapType: 'overname', reason: '' };
    const augustus = ['5', '8'].map((id) => ({ id: `aug-${id}`, requesterId: '1', targetDriverId: id, status: 'approved', decidedAt: '2026-08-01T10:00:00Z', shiftDate: '2026-08-15', shiftLine: '2102', swapType: 'overname', reason: '' }));
    const mensen = [JAN, AN, oudWeg(false), els];
    const uit = bord([tussenBeiden, ...augustus], mensen, rows);
    const zonder = bord(augustus, mensen, rows);
    expect({ jan: uit.cells['1'], an: uit.cells['2'] }).toEqual({ jan: zonder.cells['1'], an: zonder.cells['2'] });
    expect(Object.keys(uit.cells).sort()).toEqual(['1', '2']);
    expect(uit.chauffeurs.map((c) => c.id)).toEqual(['1', '2']);
  });

  it('dagbord en maandbord zijn gelijk, ook als hij op die dag geen code heeft (tegenlezing 29-09)', () => {
    // Jan gaf 2102 (01/09) aan Oud Weg, die daarna vertrok. Diens kolom is op
    // 01/09 leeg en heeft alleen op 02/09 een code. De schrijfpaden rekenen het
    // bord van één dag, de maandplanning en de Dagafsluiting dat van de maand.
    const rows = [
      { source_date: '2026-09-01', day_type: '21', assignments: { 'Jan Janssen': '2102', 'An Peeters': 'vrij' } },
      { source_date: '2026-09-02', day_type: '22', assignments: { 'Jan Janssen': 'vrij', 'An Peeters': 'vrij', 'Oud Weg': '2703' } },
    ];
    const overname = [ruil({ swapType: 'overname', returnDate: undefined, returnCode: undefined })];
    const maand = bord(overname, [JAN, AN, oudWeg(false)], rows);
    const dag = bord(overname, [JAN, AN, oudWeg(false)], [rows[0]]);
    expect(dag.cells['1']['2026-09-01']).toEqual(maand.cells['1']['2026-09-01']);
    expect(maand.cells['1']['2026-09-01']).toMatchObject({ code: 'vrij', swapId: 'r1', swapAway: true, swapTo: 'Oud Weg' });
  });
});

