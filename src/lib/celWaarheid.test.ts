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

  it('1-op-1: het been naar de vertrokken gever wordt overgeslagen, de ontvanger houdt wat hij kreeg', () => {
    const uit = bord([ruil({ swapType: 'ruil', returnDate: '2026-09-02', returnCode: '2102' })]);
    expect(uit.cells['2']['2026-09-01']).toMatchObject({ code: '2102', swapFrom: 'Oud Weg' });
    // De terugdienst staat in de planning op naam van de vertrokken gever; op
    // het bord blijft ze in de kolom van wie ze afgaf (open punt, zie rapport).
    expect(uit.cells['2']['2026-09-02']).toMatchObject({ code: '2102' });
    expect(uit.cells['2']['2026-09-02'].swapId).toBeUndefined();
  });

  it('de ONTVANGER is vertrokken: het been naar hem wordt overgeslagen (bestaand gedrag, open punt)', () => {
    // Jan gaf zijn dienst aan Oud Weg, die daarna uit dienst ging. Het bord
    // toont de dienst nog in de kolom van Jan, zoals vóór 29-09.
    const rows = [{ source_date: '2026-09-01', day_type: '21', assignments: { 'Jan Janssen': '2102', 'Oud Weg': 'vrij' } }];
    const uit = berekenCelWaarheid('2026-09', { rows, users: mensen, services, codes, leave: [], swaps: [ruil({ requesterId: '1', targetDriverId: '5' })] as never });
    expect(uit.cells['1']['2026-09-01']).toEqual({ code: '2102', kind: 'service', label: 'Dienst 2102', segments: ['05:28–12:13 (loop 4600)', '15:28–17:27'] });
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

