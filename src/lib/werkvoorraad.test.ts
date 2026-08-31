import { describe, expect, it } from 'vitest';
import { berekenWerkvoorraad } from './werkvoorraad';
import type { LeaveRequest, PlanningMatrixImportHistory, Shift, SwapRequest, User } from '../types';

// Vaste "nu": maandag 31-08-2026, middag (lokale tijd — isoDate is lokaal).
const NOW = new Date(2026, 7, 31, 12, 0, 0);

const gebruiker = (id: string, name: string, extra: Partial<User> = {}): User =>
  ({ id, name, role: 'chauffeur', employeeId: `VHB-${id}`, ...extra }) as User;

const dienst = (driverId: string, date: string, line = '2101', startTime = '06:00'): Shift => ({
  id: `${driverId}-${date}-${line}`,
  date,
  startTime,
  endTime: '14:00',
  line,
  busNumber: '',
  loopnr: '',
  driverId,
});

const verlof = (userId: string, startDate: string, endDate: string, extra: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id: `l-${userId}-${startDate}`,
  userId,
  startDate,
  endDate,
  type: 'ziekte',
  status: 'approved',
  createdAt: '2026-08-01T00:00:00Z',
  ...extra,
});

const ruil = (id: string, status: SwapRequest['status']): SwapRequest =>
  ({ id, shiftId: 's1', requesterId: '1', status, createdAt: '2026-08-30T10:00:00Z' }) as SwapRequest;

const importRij = (createdAt: string, extra: Partial<PlanningMatrixImportHistory> = {}): PlanningMatrixImportHistory =>
  ({
    id: 'imp1',
    createdAt,
    importedDays: 61,
    detectedDrivers: 38,
    generatedShifts: 500,
    matchedServices: 480,
    skippedAbsences: 3,
    unknownCodes: [],
    unmatchedDrivers: [],
    ...extra,
  }) as PlanningMatrixImportHistory;

const basis = () => ({
  users: [] as User[],
  shifts: [] as Shift[],
  leaveRequests: [] as LeaveRequest[],
  swaps: [] as SwapRequest[],
  matrixHistory: [] as PlanningMatrixImportHistory[],
  coverageDays: null,
  vervaldata: [],
  pendingDevices: [],
  now: NOW,
});

describe('berekenWerkvoorraad', () => {
  it('lege invoer: niets open, geen valse signalen', () => {
    const wv = berekenWerkvoorraad(basis());
    expect(wv.attentionCount).toBe(0);
    expect(wv.needsAttention).toBe(false);
    expect(wv.daysSinceImport).toBeNull();
    expect(wv.planningStale).toBe(false);
    expect(wv.horizonDagenOver).toBeNull();
    expect(wv.horizonKrap).toBe(false);
    expect(wv.gapDays).toEqual([]);
  });

  it('planning verouderd: > 7 dagen sinds import telt, nooit geïmporteerd niet', () => {
    const oud = berekenWerkvoorraad({ ...basis(), matrixHistory: [importRij('2026-08-23T06:00:00Z')] });
    expect(oud.daysSinceImport).toBe(8);
    expect(oud.planningStale).toBe(true);
    expect(oud.attentionCount).toBe(1);

    const vers = berekenWerkvoorraad({ ...basis(), matrixHistory: [importRij('2026-08-28T06:00:00Z')] });
    expect(vers.planningStale).toBe(false);
    expect(vers.attentionCount).toBe(0);
  });

  it('import-aandachtspunten: onbekende codes + niet-gematchte chauffeurs', () => {
    const wv = berekenWerkvoorraad({
      ...basis(),
      matrixHistory: [importRij('2026-08-30T06:00:00Z', { unknownCodes: ['xx', 'yy'], unmatchedDrivers: ['Piet'] })],
    });
    expect(wv.importIssueCount).toBe(3);
    expect(wv.attentionCount).toBe(1); // telt als één signaal
  });

  it('horizon: krap binnen 5 dagen (of op), ruim niet', () => {
    const krap = berekenWerkvoorraad({ ...basis(), shifts: [dienst('1', '2026-09-03')] });
    expect(krap.horizonDagenOver).toBe(3);
    expect(krap.horizonKrap).toBe(true);

    const op = berekenWerkvoorraad({ ...basis(), shifts: [dienst('1', '2026-08-30')] });
    expect(op.horizonKrap).toBe(true);

    const ruim = berekenWerkvoorraad({ ...basis(), shifts: [dienst('1', '2026-09-10')] });
    expect(ruim.horizonDagenOver).toBe(10);
    expect(ruim.horizonKrap).toBe(false);
  });

  it('vervaldata: alleen actieve chauffeurs, binnen 30 dagen, urgentste eerst', () => {
    const wv = berekenWerkvoorraad({
      ...basis(),
      users: [gebruiker('1', 'An'), gebruiker('2', 'Bert', { isActive: false }), gebruiker('3', 'Cas')],
      vervaldata: [
        { userId: '1', soort: 'code95', validUntil: '2026-09-20' },       // over 20 dagen
        { userId: '2', soort: 'code95', validUntil: '2026-09-01' },       // inactief → telt niet
        { userId: '3', soort: 'schifting', validUntil: '2026-08-29' },    // verlopen (-2)
        { userId: '1', soort: 'schifting', validUntil: '2026-12-01' },    // > 30 dagen → telt niet
      ],
    });
    expect(wv.vervalTaken.map((e) => e.dagen)).toEqual([-2, 20]);
  });

  it('ruilen: pending en accepted tellen, approved niet', () => {
    const wv = berekenWerkvoorraad({
      ...basis(),
      swaps: [ruil('a', 'pending'), ruil('b', 'accepted'), ruil('c', 'approved'), ruil('d', 'rejected')],
    });
    expect(wv.pendingSwaps.map((s) => s.id)).toEqual(['a', 'b']);
  });

  it('te herverdelen: diensten van afwezig gemelde chauffeurs, per chauffeur gegroepeerd met naam', () => {
    const wv = berekenWerkvoorraad({
      ...basis(),
      users: [gebruiker('7', 'Bianca')],
      shifts: [dienst('7', '2026-08-31', '2101'), dienst('7', '2026-09-01', '2102'), dienst('8', '2026-08-31', '2103')],
      leaveRequests: [verlof('7', '2026-08-31', '2026-09-02')],
    });
    expect(wv.teHerverdelen).toHaveLength(2);
    expect(wv.herverdeelPerChauffeur).toHaveLength(1);
    expect(wv.herverdeelPerChauffeur[0].naam).toBe('Bianca');
    expect(wv.herverdeelPerChauffeur[0].diensten).toHaveLength(2);
  });

  it('dekking: null = onbekend (geen rijen), alleen dagen mét gat tellen', () => {
    const wv = berekenWerkvoorraad({
      ...basis(),
      coverageDays: [
        { date: '2026-09-01', dayType: 'schooldag', expected: 17, covered: 17, missing: [] },
        { date: '2026-09-02', dayType: 'schooldag', expected: 17, covered: 15, missing: ['2101', '2102'] },
      ],
    });
    expect(wv.gapDays.map((d) => d.date)).toEqual(['2026-09-02']);
  });

  it('attentionCount: som van signalen en items', () => {
    const wv = berekenWerkvoorraad({
      ...basis(),
      users: [gebruiker('7', 'Bianca')],
      // Horizon ruim zodat die niet meetelt.
      shifts: [dienst('7', '2026-08-31'), dienst('9', '2026-10-15')],
      leaveRequests: [
        verlof('7', '2026-08-31', '2026-09-02'),                                  // 1 te herverdelen
        verlof('7', '2026-09-10', '2026-09-10', { status: 'pending', type: 'betaald_verlof' }), // 1 open aanvraag
      ],
      swaps: [ruil('a', 'pending')],                                              // 1 ruil
      matrixHistory: [importRij('2026-08-20T06:00:00Z')],                          // stale = 1
      pendingDevices: [{ userId: '7', name: 'iPhone', createdAt: '2026-08-30T10:00:00Z' }], // 1
    });
    // stale(1) + herverdelen(1) + verlof(1) + ruil(1) + toestel(1) = 5
    expect(wv.attentionCount).toBe(5);
    expect(wv.needsAttention).toBe(true);
  });
});
