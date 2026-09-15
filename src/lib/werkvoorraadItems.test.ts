import { describe, expect, it } from 'vitest';
import { berekenWerkvoorraad, sindsTekst, telPerSoort, werkvoorraadItems } from './werkvoorraad';
import type { LeaveRequest, PlanningMatrixImportHistory, Shift, SwapRequest, User } from '../types';

// Vaste "nu": maandag 31-08-2026, middag (lokale tijd, isoDate is lokaal).
const NOW = new Date(2026, 7, 31, 12, 0, 0);

const gebruiker = (id: string, name: string): User =>
  ({ id, name, role: 'chauffeur', employeeId: `VHB-${id}`, isActive: true }) as User;

const dienst = (driverId: string, date: string, line = '2101'): Shift => ({
  id: `${driverId}-${date}-${line}`, date, startTime: '06:00', endTime: '14:00', line, busNumber: '', loopnr: '', driverId,
});

const verlof = (id: string, userId: string, createdAt: string, extra: Partial<LeaveRequest> = {}): LeaveRequest => ({
  id, userId, startDate: '2026-09-10', endDate: '2026-09-12', type: 'betaald_verlof', status: 'pending', createdAt, ...extra,
});

const ruil = (id: string, createdAt: string): SwapRequest =>
  ({ id, shiftId: 's1', requesterId: '1', targetDriverId: '2', status: 'pending', createdAt }) as SwapRequest;

const importRij = (createdAt: string): PlanningMatrixImportHistory =>
  ({ id: 'imp1', createdAt, importedDays: 61, detectedDrivers: 38, generatedShifts: 500, matchedServices: 480, skippedAbsences: 3, unknownCodes: ['XX'], unmatchedDrivers: [] }) as PlanningMatrixImportHistory;

const opts = {
  naamVan: (id: string) => ({ '1': 'An', '2': 'Bert', '3': 'Cas' })[id] ?? 'Onbekend',
  now: NOW,
  formatDag: (iso: string) => iso,
};

describe('werkvoorraadItems', () => {
  it('lege werkvoorraad = geen items', () => {
    const wv = berekenWerkvoorraad({ users: [], shifts: [], leaveRequests: [], swaps: [], matrixHistory: [], coverageDays: null, vervaldata: [], pendingDevices: [], now: NOW });
    expect(werkvoorraadItems(wv, opts)).toEqual([]);
    expect(Object.values(telPerSoort([])).every((n) => n === 0)).toBe(true);
  });

  it('som van aantal = attentionCount; herverdelen telt per dienst maar is één rij per chauffeur', () => {
    const users = [gebruiker('1', 'An'), gebruiker('2', 'Bert'), gebruiker('3', 'Cas')];
    const wv = berekenWerkvoorraad({
      users,
      shifts: [dienst('3', '2026-09-01'), dienst('3', '2026-09-02'), dienst('3', '2026-09-03', '2607')],
      leaveRequests: [
        verlof('l1', '1', '2026-08-29T08:00:00Z'),
        verlof('l2', '2', '2026-08-30T08:00:00Z'),
        // Cas is ziek gemeld: zijn drie diensten staan open om te herverdelen.
        verlof('z1', '3', '2026-08-31T07:00:00Z', { type: 'ziekte', status: 'approved', startDate: '2026-08-31', endDate: '2026-09-05' }),
      ],
      swaps: [ruil('r1', '2026-08-28T10:00:00Z')],
      matrixHistory: [importRij('2026-08-20T06:00:00Z')],
      coverageDays: [{ date: '2026-09-02', dayType: 'werkdag', expected: 5, covered: 4, missing: ['2607'] } as never],
      vervaldata: [{ userId: '1', soort: 'code95', validUntil: '2026-09-10' }],
      pendingDevices: [{ userId: '2', name: 'iPhone', createdAt: '2026-08-31T09:00:00Z' }],
      now: NOW,
    });
    const items = werkvoorraadItems(wv, opts);
    const som = items.reduce((n, it) => n + it.aantal, 0);
    expect(som).toBe(wv.attentionCount);

    const herverdeel = items.filter((it) => it.soort === 'herverdelen');
    expect(herverdeel).toHaveLength(1);
    expect(herverdeel[0].aantal).toBe(3);
    expect(herverdeel[0].naam).toBe('Cas');

    const tellers = telPerSoort(items);
    expect(tellers.verlof).toBe(2);
    expect(tellers.ruil).toBe(1);
    expect(tellers.herverdelen).toBe(3);
    expect(tellers.dekking).toBe(1);
    expect(tellers.toestellen).toBe(1);
    expect(tellers.vervaldata).toBe(1);
    // Import van 11 dagen geleden (stale), een onbekende code (import-aandachtspunt)
    // en een planning die over 3 dagen op is (horizon krap): drie signalen.
    expect(tellers.planning).toBe(3);
  });

  it('sorteert op wat dringt: oudste aanvraag eerst, datums dichtstbij eerst', () => {
    const users = [gebruiker('1', 'An'), gebruiker('2', 'Bert')];
    const wv = berekenWerkvoorraad({
      users, shifts: [],
      leaveRequests: [verlof('nieuw', '1', '2026-08-31T10:00:00Z'), verlof('oud', '2', '2026-08-25T10:00:00Z')],
      swaps: [], matrixHistory: [], coverageDays: [],
      vervaldata: [{ userId: '1', soort: 'code95', validUntil: '2026-09-20' }, { userId: '2', soort: 'schifting', validUntil: '2026-08-20' }],
      pendingDevices: [], now: NOW,
    });
    const items = werkvoorraadItems(wv, opts);
    expect(items.map((it) => it.key)).toEqual(['verval:2:schifting', 'verlof:oud', 'verlof:nieuw', 'verval:1:code95']);
    expect(items[0].tone).toBe('red');
    expect(items[0].wanneerTekst).toBe('11 dagen verlopen');
    expect(items[1].wanneerTekst).toBe('6 dagen geleden');
    expect(items[3].wanneerTekst).toBe('over 20 dagen');
  });

  it('open diensten linken naar de maand van de dag; toestellen dragen hun rij mee', () => {
    // Relatief aan NOW (lokale tijd), anders hangt de tekst af van de tijdzone van de runner.
    const halfUurGeleden = new Date(NOW.getTime() - 30 * 60000).toISOString();
    const wv = berekenWerkvoorraad({
      users: [gebruiker('2', 'Bert')], shifts: [], leaveRequests: [], swaps: [], matrixHistory: [],
      coverageDays: [{ date: '2026-10-03', dayType: 'zaterdag', expected: 3, covered: 1, missing: ['2101', '2607'] } as never],
      vervaldata: [],
      pendingDevices: [{ userId: '2', name: 'Pixel', createdAt: halfUurGeleden }],
      now: NOW,
    });
    const items = werkvoorraadItems(wv, opts);
    const gat = items.find((it) => it.soort === 'dekking');
    expect(gat?.doel).toBe('dekking');
    expect(gat?.doelParams).toEqual(['2026-10']);
    expect(gat?.titel).toBe('2 open diensten, 2026-10-03');
    const toestel = items.find((it) => it.soort === 'toestellen');
    expect(toestel?.toestel).toEqual({ userId: '2', name: 'Pixel', createdAt: halfUurGeleden });
    expect(toestel?.wanneerTekst).toBe('30 min geleden');
  });
});

describe('sindsTekst', () => {
  it('trapt af van minuten naar dagen', () => {
    expect(sindsTekst('2026-08-31T11:59:40Z', new Date('2026-08-31T12:00:00Z'))).toBe('zojuist');
    expect(sindsTekst('2026-08-31T11:15:00Z', new Date('2026-08-31T12:00:00Z'))).toBe('45 min geleden');
    expect(sindsTekst('2026-08-31T08:00:00Z', new Date('2026-08-31T12:00:00Z'))).toBe('4 u geleden');
    expect(sindsTekst('2026-08-30T08:00:00Z', new Date('2026-08-31T12:00:00Z'))).toBe('gisteren');
    expect(sindsTekst('2026-08-25T08:00:00Z', new Date('2026-08-31T12:00:00Z'))).toBe('6 dagen geleden');
    expect(sindsTekst('2026-09-01T08:00:00Z', new Date('2026-08-31T12:00:00Z'))).toBe('');
    expect(sindsTekst('kapot', new Date('2026-08-31T12:00:00Z'))).toBe('');
  });
});
