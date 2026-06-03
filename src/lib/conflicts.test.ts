import { describe, it, expect } from 'vitest';
import type { LeaveRequest, Shift } from '../types';
import {
  detectShiftLeaveConflicts,
  leaveIdsWithConflict,
  shiftIdsWithConflict,
  shiftsConflictingWithLeave,
} from './conflicts';

const shift = (id: string, driverId: string, date: string): Shift => ({
  id,
  driverId,
  date,
  startTime: '06:00',
  endTime: '14:00',
  line: '12',
  busNumber: '101',
  loopnr: 'L1',
});

const leave = (
  id: string,
  userId: string,
  startDate: string,
  endDate: string,
  status: LeaveRequest['status'] = 'approved',
  type: LeaveRequest['type'] = 'betaald_verlof',
): LeaveRequest => ({
  id,
  userId,
  startDate,
  endDate,
  type,
  status,
  createdAt: new Date('2026-01-01').toISOString(),
});

describe('conflicts — detectShiftLeaveConflicts', () => {
  it('matcht een shift met een verlofdag op dezelfde datum', () => {
    const shifts = [shift('s1', 'driver-1', '2026-07-01')];
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-05')];

    const conflicts = detectShiftLeaveConflicts(shifts, leaves);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      shiftId: 's1',
      leaveId: 'l1',
      userId: 'driver-1',
      date: '2026-07-01',
    });
  });

  it('matcht shifts overal binnen het verlofbereik (start, midden, eind)', () => {
    const shifts = [
      shift('s-start', 'driver-1', '2026-07-01'),
      shift('s-mid', 'driver-1', '2026-07-03'),
      shift('s-end', 'driver-1', '2026-07-05'),
    ];
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-05')];

    expect(detectShiftLeaveConflicts(shifts, leaves)).toHaveLength(3);
  });

  it('matcht NIET als de datum buiten het verlofbereik ligt', () => {
    const shifts = [
      shift('s-before', 'driver-1', '2026-06-30'),
      shift('s-after', 'driver-1', '2026-07-06'),
    ];
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-05')];

    expect(detectShiftLeaveConflicts(shifts, leaves)).toHaveLength(0);
  });

  it('matcht NIET als userId verschilt', () => {
    const shifts = [shift('s1', 'driver-2', '2026-07-01')];
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-05')];

    expect(detectShiftLeaveConflicts(shifts, leaves)).toHaveLength(0);
  });

  it('negeert verlof met status rejected of cancelled', () => {
    const shifts = [shift('s1', 'driver-1', '2026-07-01')];
    const leaves = [
      leave('l-rejected', 'driver-1', '2026-07-01', '2026-07-05', 'rejected'),
      leave('l-cancelled', 'driver-1', '2026-07-01', '2026-07-05', 'cancelled'),
    ];

    expect(detectShiftLeaveConflicts(shifts, leaves)).toHaveLength(0);
  });

  it('met onlyApproved=false: matcht ook pending verlof', () => {
    const shifts = [shift('s1', 'driver-1', '2026-07-01')];
    const leaves = [leave('l-pending', 'driver-1', '2026-07-01', '2026-07-05', 'pending')];

    expect(detectShiftLeaveConflicts(shifts, leaves, { onlyApproved: false })).toHaveLength(1);
    expect(detectShiftLeaveConflicts(shifts, leaves, { onlyApproved: true })).toHaveLength(0);
  });

  it('matcht klein_verlet net zo goed als betaald_verlof', () => {
    const shifts = [shift('s1', 'driver-1', '2026-07-01')];
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-01', 'approved', 'klein_verlet')];

    expect(detectShiftLeaveConflicts(shifts, leaves)).toHaveLength(1);
  });

  it('één verlof + drie shifts = drie conflicten', () => {
    const shifts = [
      shift('s1', 'driver-1', '2026-07-01'),
      shift('s2', 'driver-1', '2026-07-02'),
      shift('s3', 'driver-1', '2026-07-03'),
    ];
    const leaves = [leave('l1', 'driver-1', '2026-07-01', '2026-07-03')];

    expect(detectShiftLeaveConflicts(shifts, leaves)).toHaveLength(3);
  });

  it('lege arrays geven leeg resultaat', () => {
    expect(detectShiftLeaveConflicts([], [])).toEqual([]);
    expect(detectShiftLeaveConflicts([shift('s1', 'd1', '2026-07-01')], [])).toEqual([]);
    expect(detectShiftLeaveConflicts([], [leave('l1', 'd1', '2026-07-01', '2026-07-05')])).toEqual([]);
  });
});

describe('conflicts — set helpers', () => {
  const shifts = [
    shift('s1', 'driver-1', '2026-07-01'),
    shift('s2', 'driver-1', '2026-07-02'),
    shift('s3', 'driver-2', '2026-07-01'),
  ];
  const leaves = [
    leave('l1', 'driver-1', '2026-07-01', '2026-07-02'),
    leave('l2', 'driver-2', '2026-08-01', '2026-08-05'),
  ];

  it('shiftIdsWithConflict geeft alleen IDs van conflicterende shifts', () => {
    const ids = shiftIdsWithConflict(shifts, leaves);
    expect(ids.has('s1')).toBe(true);
    expect(ids.has('s2')).toBe(true);
    expect(ids.has('s3')).toBe(false);
    expect(ids.size).toBe(2);
  });

  it('leaveIdsWithConflict geeft alleen IDs van verlofaanvragen met conflict', () => {
    const ids = leaveIdsWithConflict(shifts, leaves);
    expect(ids.has('l1')).toBe(true);
    expect(ids.has('l2')).toBe(false);
  });
});

describe('conflicts — shiftsConflictingWithLeave', () => {
  it('geeft alle shifts van die chauffeur in het verlofbereik', () => {
    const shifts = [
      shift('s1', 'driver-1', '2026-07-01'),
      shift('s2', 'driver-1', '2026-07-03'),
      shift('s3', 'driver-1', '2026-07-10'), // buiten bereik
      shift('s4', 'driver-2', '2026-07-01'), // andere chauffeur
    ];
    const myLeave = leave('l1', 'driver-1', '2026-07-01', '2026-07-05');

    const result = shiftsConflictingWithLeave(shifts, myLeave);
    expect(result.map((s) => s.id)).toEqual(['s1', 's2']);
  });
});
