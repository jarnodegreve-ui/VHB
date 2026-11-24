import { describe, expect, it } from 'vitest';
import { bouwDagBriefing, bouwWeekPunten, briefingKop, dagWoordVoor } from './dagBriefing';
import type { Diversion, LeaveRequest, Shift, SwapRequest, User } from '../types';

const DAG = '2026-09-22';
const users = [
  { id: '3', name: 'An Peeters', role: 'chauffeur', phone: '0470 11 22 33' },
  { id: '4', name: 'Bert Maes', role: 'chauffeur' },
  { id: '5', name: 'Cis Claes', role: 'chauffeur' },
] as unknown as User[];
const dienst = (id: string, driverId: string, date: string, line: string, startTime = '05:30'): Shift =>
  ({ id, driverId, date, line, startTime, endTime: '13:45', busNumber: '' }) as Shift;
const verlof = (id: string, userId: string, type: LeaveRequest['type'], startDate: string, endDate: string, status: LeaveRequest['status'] = 'approved'): LeaveRequest =>
  ({ id, userId, type, startDate, endDate, status, createdAt: '2026-09-01T08:00:00Z' });
const ruil = (over: Partial<SwapRequest>): SwapRequest =>
  ({ id: 'r', shiftId: 's', requesterId: '3', targetDriverId: '4', status: 'accepted', createdAt: '2026-09-20T08:00:00Z', ...over }) as SwapRequest;
const leeg = { dag: DAG, users, shifts: [] as Shift[], leaveRequests: [] as LeaveRequest[], swaps: [] as SwapRequest[], diversions: [] as Diversion[], coverageDays: [] };

describe('bouwDagBriefing › afwezigen', () => {
  it('één regel per persoon, ziekte wint van verlof, en wie nog een dienst heeft staat bovenaan', () => {
    const b = bouwDagBriefing({
      ...leeg,
      shifts: [dienst('s1', '4', DAG, '2101'), dienst('s2', '4', '2026-09-23', '2230')],
      leaveRequests: [
        verlof('l1', '3', 'betaald_verlof', '2026-09-20', '2026-09-25'),
        verlof('l2', '3', 'ziekte', DAG, DAG),
        verlof('l3', '4', 'ziekte', '2026-09-21', '2026-09-24'),
        verlof('l4', '5', 'betaald_verlof', DAG, DAG, 'pending'),
      ],
    });
    expect(b.afwezigen.map((a) => [a.naam, a.type, a.diensten.map((d) => d.line)])).toEqual([
      ['Bert Maes', 'ziekte', ['2101']],
      ['An Peeters', 'ziekte', []],
    ]);
    expect(b.afwezigen[1].phone).toBe('0470 11 22 33');
  });

  it('een gesplitste dienst telt één keer', () => {
    const b = bouwDagBriefing({
      ...leeg,
      shifts: [dienst('a', '4', DAG, '2515', '06:05'), dienst('b', '4', DAG, '2515', '15:10')],
      leaveRequests: [verlof('l', '4', 'ziekte', DAG, DAG)],
    });
    expect(b.afwezigen[0].diensten).toHaveLength(1);
    expect(b.aandacht).toBe(1);
  });
});

describe('bouwDagBriefing › open diensten', () => {
  it('onbekende dekking is null, geen lege lijst', () => {
    expect(bouwDagBriefing({ ...leeg, coverageDays: null }).openDiensten).toBeNull();
  });

  it('een dienst die al onder "te herverdelen" staat telt niet nog eens als open dienst', () => {
    const b = bouwDagBriefing({
      ...leeg,
      shifts: [dienst('s1', '4', DAG, '2101')],
      leaveRequests: [verlof('l', '4', 'ziekte', DAG, DAG)],
      coverageDays: [{ date: DAG, missing: ['2101', '2230'] }, { date: '2026-09-23', missing: ['9999'] }] as never,
    });
    expect(b.openDiensten).toEqual(['2230']);
    expect(b.aandacht).toBe(2);
  });
});

describe('bouwDagBriefing › ruilen', () => {
  it('toont een ruil langs de dienst én langs de tegenprestatie, open ruilen eerst', () => {
    const b = bouwDagBriefing({
      ...leeg,
      swaps: [
        ruil({ id: 'a', status: 'approved', shiftDate: DAG, shiftLine: '2101' }),
        ruil({ id: 'b', status: 'accepted', shiftDate: '2026-09-30', shiftLine: '2300', returnDate: DAG, returnCode: '2230' }),
        ruil({ id: 'c', status: 'rejected', shiftDate: DAG, shiftLine: '2400' }),
        ruil({ id: 'd', status: 'pending', shiftDate: '2026-09-30', shiftLine: '2500', returnDate: DAG, returnCode: 'VRIJ' }),
      ],
    });
    expect(b.ruilen.map((r) => [r.swap.id, r.kant, r.dienst, r.vanId, r.naarId, r.open])).toEqual([
      ['b', 'tegenprestatie', '2230', '4', '3', true],
      ['a', 'dienst', '2101', '3', '4', false],
    ]);
    expect(b.aandacht).toBe(1);
  });
});

describe('bouwDagBriefing › omleidingen en kop', () => {
  it('alleen omleidingen die op de dag lopen', () => {
    const b = bouwDagBriefing({
      ...leeg,
      diversions: [
        { id: 'd1', line: '58', title: 'Markt', startDate: '2026-09-01', endDate: '2026-09-30' },
        { id: 'd2', line: '23', title: 'Voorbij', startDate: '2026-09-01', endDate: '2026-09-10' },
        { id: 'd3', line: '40', title: 'Komt nog', startDate: '2026-09-23', endDate: '2026-09-30' },
      ] as unknown as Diversion[],
    });
    expect(b.omleidingen.map((d) => d.id)).toEqual(['d1']);
  });

  it('de kop telt punten, en zegt eerlijk wanneer de dekking nog onbekend is', () => {
    expect(briefingKop(bouwDagBriefing(leeg), 'vandaag')).toBe('Alles geregeld voor vandaag');
    expect(briefingKop(bouwDagBriefing({ ...leeg, coverageDays: null }), 'morgen')).toBe('Dekking voor morgen nog niet geladen');
    expect(briefingKop(bouwDagBriefing({ ...leeg, coverageDays: [{ date: DAG, missing: ['2101'] }] as never }), 'vandaag')).toBe('1 punt vraagt nog een beslissing');
  });
});

describe('bouwWeekPunten › de weekstrook', () => {
  const bron = {
    ...leeg,
    shifts: [dienst('s1', '4', '2026-09-24', '2101')],
    leaveRequests: [verlof('l1', '4', 'ziekte', '2026-09-24', '2026-09-24')],
    swaps: [ruil({ status: 'pending', shiftDate: '2026-09-28', shiftLine: '2230' })],
    coverageDays: [{ date: DAG, missing: ['4407', '4408'] }, { date: '2026-09-24', missing: ['2101'] }] as never,
  };

  it('zeven dagen vanaf vandaag, met per dag dezelfde telling als de briefing van die dag', () => {
    const week = bouwWeekPunten({ ...bron, vandaag: DAG });
    expect(week.map((w) => w.dag)).toEqual(['2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-09-28']);
    // 22: twee open diensten; 24: één te herverdelen (2101 telt niet dubbel als open); 28: één open ruil.
    expect(week.map((w) => w.aandacht)).toEqual([2, 0, 1, 0, 0, 0, 1]);
    expect(week.every((w) => !w.onbekend)).toBe(true);
    for (const w of week) expect(w.aandacht).toBe(bouwDagBriefing({ ...bron, dag: w.dag }).aandacht);
  });

  it('zonder dekking is elke dag onbekend, over een maandgrens heen blijven het zeven dagen', () => {
    const week = bouwWeekPunten({ ...leeg, vandaag: '2026-09-28', coverageDays: null });
    expect(week.map((w) => w.dag)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(week.every((w) => w.onbekend && w.aandacht === 0)).toBe(true);
  });
});

// Na de grens van de dekking (24-11, tegenlezing dekking-grens): de server
// geeft voor die dag geen rij meer. Zonder eigen staat las een ontbrekende rij
// als "geen open diensten" en zei Vandaag "Alles geregeld" en "Niets te melden".
describe('na de grens van de dekking', () => {
  const GRENS = '2027-01-03';
  const tot3jan = [{ date: '2027-01-02', missing: ['2607'] }, { date: GRENS, missing: [] }] as never;
  const bron = { ...leeg, coverageDays: tot3jan, planningTot: GRENS };

  it('een dag na de grens heeft geen planning: geen open diensten, en de kop zegt dat, niet "Alles geregeld"', () => {
    const b = bouwDagBriefing({ ...bron, dag: '2027-01-04' });
    expect(b.geenPlanning).toBe(true);
    expect(b.openDiensten).toEqual([]);
    expect(b.aandacht).toBe(0);
    expect(briefingKop(b, 'maandag')).toBe('Geen planning voor maandag');
  });

  it('tot en met de grens zoals vroeger; zonder grens of met onbekende dekking ook', () => {
    expect(bouwDagBriefing({ ...bron, dag: GRENS }).geenPlanning).toBe(false);
    expect(bouwDagBriefing({ ...bron, dag: '2027-01-02' }).openDiensten).toEqual(['2607']);
    const zonderGrens = bouwDagBriefing({ ...bron, planningTot: null, dag: '2027-01-04' });
    expect(zonderGrens.geenPlanning).toBe(false);
    expect(briefingKop(zonderGrens, 'maandag')).toBe('Alles geregeld voor maandag');
    const onbekend = bouwDagBriefing({ ...bron, coverageDays: null, dag: '2027-01-04' });
    expect(onbekend.geenPlanning).toBe(false);
    expect(briefingKop(onbekend, 'maandag')).toBe('Dekking voor maandag nog niet geladen');
  });

  it('een open ruil op een dag na de grens blijft een punt dat een beslissing vraagt', () => {
    const b = bouwDagBriefing({ ...bron, dag: '2027-01-04', swaps: [ruil({ status: 'pending', shiftDate: '2027-01-04', shiftLine: '2230' })] });
    expect(b.geenPlanning).toBe(true);
    expect(b.aandacht).toBe(1);
    expect(briefingKop(b, 'maandag')).toBe('1 punt vraagt nog een beslissing');
  });

  it('de weekstrook markeert de dagen na de grens, met dezelfde telling als de briefing', () => {
    const week = bouwWeekPunten({ ...bron, vandaag: '2026-12-30' });
    expect(week.map((w) => w.dag)).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-04', '2027-01-05']);
    expect(week.map((w) => w.geenPlanning)).toEqual([false, false, false, false, false, true, true]);
    expect(week.every((w) => !w.onbekend)).toBe(true);
    expect(week.map((w) => w.aandacht)).toEqual([0, 0, 0, 1, 0, 0, 0]);
    expect(bouwWeekPunten({ ...bron, planningTot: null, vandaag: '2026-12-30' }).some((w) => w.geenPlanning)).toBe(false);
  });
});

describe('dagWoordVoor', () => {
  it('vandaag, morgen, daarna de weekdag', () => {
    expect(dagWoordVoor('2026-09-22', '2026-09-22')).toBe('vandaag');
    expect(dagWoordVoor('2026-09-23', '2026-09-22')).toBe('morgen');
    expect(dagWoordVoor('2026-09-24', '2026-09-22')).toBe('donderdag');
    // De laatste dag van de weekstrook (zes dagen verder), een zondag en een maandag.
    expect(dagWoordVoor('2026-09-27', '2026-09-22')).toBe('zondag');
    expect(dagWoordVoor('2026-09-28', '2026-09-22')).toBe('maandag');
    expect(dagWoordVoor('2026-10-01', '2026-09-30')).toBe('morgen');
  });
});
