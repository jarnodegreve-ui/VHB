import { describe, expect, it } from 'vitest';
import { berekenCelWaarheid } from '../../api/_lib/celWaarheid';
import { kalenderUitDekking } from '../../shared/dagtype';

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

describe('berekenCelWaarheid met afwijkingen per dagtype (10-10)', () => {
  const school = [{ id: '7', name: 'Jelle School', role: 'chauffeur', isActive: true, section: 'Schoolvervoer', startDate: '2019-01-01' }];
  const eek6 = {
    serviceNumber: 'EEK6', startTime: '07:10', endTime: '08:40', startTime2: '15:20', endTime2: '16:50',
    varianten: [{ dagtypes: ['23'], startTime: '07:10', endTime: '08:40', startTime2: '11:50', endTime2: '13:20', loopnr2: 'W' }],
  };
  const matrix = [
    { source_date: '2026-10-13', day_type: '22', assignments: { 'Jelle School': 'EEK6' } },
    { source_date: '2026-10-14', day_type: '', assignments: { 'Jelle School': 'EEK6' } },
    { source_date: '2026-10-15', day_type: '24', assignments: { 'Jelle School': 'EEK6' } },
  ];

  it('toont per dag de tijden van dat dagtype en geeft het dagtype per dag mee', () => {
    const uit = berekenCelWaarheid('2026-10', { rows: matrix, users: school, services: [eek6], codes: [], leave: [], swaps: [] });
    expect(uit.dagtypes).toEqual({ '2026-10-13': '22', '2026-10-14': '23', '2026-10-15': '24' });
    expect(uit.cells['7']['2026-10-13'].segments).toEqual(['07:10–08:40', '15:20–16:50']);
    expect(uit.cells['7']['2026-10-14'].segments).toEqual(['07:10–08:40', '11:50–13:20 (loop W)']);
    expect(uit.cells['7']['2026-10-15'].segments).toEqual(['07:10–08:40', '15:20–16:50']);
  });

  it('de kalender maakt van een lege matrixdag een vakantiedag, en dan geldt de afwijking niet', () => {
    const kalender = kalenderUitDekking({ __uitzonderingen__: ['2026-10-12..2026-10-16|vakantie'] });
    const uit = berekenCelWaarheid('2026-10', { rows: matrix, users: school, services: [eek6], codes: [], leave: [], swaps: [], kalender });
    expect(uit.dagtypes['2026-10-14']).toBe('33');
    expect(uit.cells['7']['2026-10-14'].segments).toEqual(['07:10–08:40', '15:20–16:50']);
    // De Excel-code wint van de kalender.
    expect(uit.dagtypes['2026-10-13']).toBe('22');
  });
});

describe('berekenCelWaarheid met dienstregelingversies (13-10)', () => {
  // Jarno 13-10: na een nieuwe dienstregeling vanaf 09/11 toonde het celdetail
  // van het bord nog de oude uren, want het bord las de versie van vandaag
  // voor de hele maand. Nu telt per dag de versie die op die dag geldt.
  const oud = [{ serviceNumber: '2102', startTime: '05:28', endTime: '12:13', loopnr: '4600' }];
  const nieuw = [{ serviceNumber: '2102', startTime: '05:40', endTime: '12:20', loopnr: '4601' }, { serviceNumber: '2199', startTime: '06:00', endTime: '14:00' }];
  const versies = [{ id: 'v-sep', geldigVanaf: '2026-09-01', services: oud }, { id: 'v-nov', geldigVanaf: '2026-11-09', services: nieuw }];
  const rijen = [
    { source_date: '2026-11-08', day_type: '27', assignments: { 'Jan Janssen': '2102', 'Piet Nieuw': '2199' } },
    { source_date: '2026-11-09', day_type: '21', assignments: { 'Jan Janssen': '2102', 'Piet Nieuw': '2199', 'An Peeters': 'vrij' } },
  ];

  it('neemt per dag de uren van de versie die op die dag geldt', () => {
    const uit = berekenCelWaarheid('2026-11', { rows: rijen, users, services: oud, versies, codes, leave: [], swaps: [] });
    expect(uit.cells['1']['2026-11-08'].segments).toEqual(['05:28–12:13 (loop 4600)']);
    expect(uit.cells['1']['2026-11-09'].segments).toEqual(['05:40–12:20 (loop 4601)']);
    // Een dienst die alleen in de nieuwe versie bestaat is ervoor een onbekende code.
    expect(uit.cells['3']['2026-11-08'].kind).toBe('unknown');
    expect(uit.cells['3']['2026-11-09']).toMatchObject({ kind: 'service', segments: ['06:00–14:00'] });
    // Een code zonder dag (vrij) komt uit de planningscodes, los van de versie.
    expect(uit.cells['2']['2026-11-09']).toMatchObject({ code: 'vrij', kind: 'absence' });
  });

  it('zonder versies geldt de meegegeven lijst voor elke dag', () => {
    const uit = berekenCelWaarheid('2026-11', { rows: rijen, users, services: nieuw, codes, leave: [], swaps: [] });
    expect(uit.cells['1']['2026-11-08'].segments).toEqual(['05:40–12:20 (loop 4601)']);
  });
});
