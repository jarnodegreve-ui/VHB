import { describe, expect, it } from 'vitest';
import { buildDriverReport, shiftDurationMinutes, periodLabel } from './reporting';
import type { LeaveRequest, Shift, User } from '../types';

const user = (id: string, name: string, role: User['role'] = 'chauffeur', verlofBudget?: number): User => ({
  id, name, role, employeeId: `E${id}`, isActive: true, verlofBudget,
});

const shift = (date: string, startTime: string, endTime: string, driverId: string): Shift => ({
  id: `${driverId}-${date}-${startTime}`,
  date, startTime, endTime, line: '10', busNumber: '12', loopnr: '1', driverId,
});

const leave = (userId: string, startDate: string, endDate: string, type: LeaveRequest['type'], status: LeaveRequest['status'] = 'approved'): LeaveRequest => ({
  id: `${userId}-${startDate}`, userId, startDate, endDate, type, status, createdAt: '2026-01-01T00:00:00Z',
});

describe('shiftDurationMinutes', () => {
  it('rekent een gewone dienst', () => {
    expect(shiftDurationMinutes(shift('2026-06-15', '06:00', '14:00', '1'))).toBe(480);
  });
  it('rekent een nachtdienst door tot de volgende dag', () => {
    expect(shiftDurationMinutes(shift('2026-06-15', '22:00', '02:00', '1'))).toBe(240);
  });
  it('geeft 0 bij ongeldige tijden', () => {
    expect(shiftDurationMinutes(shift('2026-06-15', '', '', '1'))).toBe(0);
  });
});

describe('buildDriverReport', () => {
  const users = [
    user('1', 'Bea Bestuurder'),
    user('2', 'Alex Anders'),
    user('9', 'Patrick Planner', 'planner'),
  ];
  const shifts = [
    shift('2026-06-01', '06:00', '14:00', '1'), // 8u
    shift('2026-06-02', '06:00', '15:00', '1'), // 9u
    shift('2026-05-30', '06:00', '14:00', '1'), // buiten juni
    shift('2026-06-01', '08:00', '12:00', '2'), // 4u
  ];
  const leaves = [
    leave('1', '2026-07-01', '2026-07-03', 'betaald_verlof'), // 3 dagen
    leave('1', '2026-03-10', '2026-03-10', 'klein_verlet'),   // 1 dag
  ];

  it('neemt alleen chauffeurs op, gesorteerd op naam', () => {
    const rows = buildDriverReport(shifts, leaves, users, { year: 2026, month: null });
    expect(rows.map((r) => r.name)).toEqual(['Alex Anders', 'Bea Bestuurder']);
  });

  it('telt diensten en uren binnen de periode (maandfilter)', () => {
    const rows = buildDriverReport(shifts, leaves, users, { year: 2026, month: 6 });
    const bea = rows.find((r) => r.driverId === '1')!;
    expect(bea.shiftsCount).toBe(2); // 30 mei valt buiten juni
    expect(bea.workedMinutes).toBe(480 + 540);
    expect(bea.workedHoursLabel).toBe('17u');
  });

  it('telt het hele jaar als month null is', () => {
    const rows = buildDriverReport(shifts, leaves, users, { year: 2026, month: null });
    const bea = rows.find((r) => r.driverId === '1')!;
    expect(bea.shiftsCount).toBe(3);
  });

  it('neemt het verlofsaldo over uit verlofBalans (jaarbasis)', () => {
    const rows = buildDriverReport(shifts, leaves, users, { year: 2026, month: 6 });
    const bea = rows.find((r) => r.driverId === '1')!;
    expect(bea.betaaldGebruikt).toBe(3);
    expect(bea.betaaldResterend).toBe(21); // 24 - 3
    expect(bea.kleinVerlet).toBe(1);
  });

  it('respecteert een afwijkend verlofBudget per gebruiker', () => {
    const rows = buildDriverReport([], [leave('1', '2026-02-01', '2026-02-05', 'betaald_verlof')], [user('1', 'Bea', 'chauffeur', 30)], { year: 2026, month: null });
    expect(rows[0].betaaldBudget).toBe(30);
    expect(rows[0].betaaldResterend).toBe(25); // 30 - 5
  });
});

describe('periodLabel', () => {
  it('toont jaar of maand+jaar', () => {
    expect(periodLabel({ year: 2026, month: null })).toBe('2026');
    expect(periodLabel({ year: 2026, month: 6 })).toBe('juni 2026');
  });
});
