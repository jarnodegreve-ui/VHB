import type { LeaveRequest, User } from '../types';

/** Standaard jaarrecht (Belgisch wettelijk) wanneer een gebruiker geen eigen recht heeft. */
export const DEFAULT_LEAVE_BALANCE = 20;

/** Verloftypes die van het jaarsaldo worden afgetrokken. */
export const DEDUCTED_LEAVE_TYPES: ReadonlyArray<LeaveRequest['type']> = ['vakantie'];

/** Het jaarrecht van een gebruiker, met terugval op de standaardwaarde. */
export function getLeaveEntitlement(user: Pick<User, 'leaveBalanceTotal'>): number {
  return typeof user.leaveBalanceTotal === 'number' && user.leaveBalanceTotal >= 0
    ? user.leaveBalanceTotal
    : DEFAULT_LEAVE_BALANCE;
}

/**
 * Telt het aantal verlofdagen in een periode (inclusief begin- en einddatum).
 * Zondagen tellen niet mee — chauffeurs werken maandag t/m zaterdag.
 * Optioneel beperkt tot één kalenderjaar.
 */
export function countLeaveDays(startDate: string, endDate: string, year?: number): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return 0;
  }

  let count = 0;
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= last) {
    const isSunday = cursor.getDay() === 0;
    const inYear = year === undefined || cursor.getFullYear() === year;
    if (!isSunday && inYear) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

/** Som van goedgekeurde, aftrekbare verlofdagen voor een gebruiker in een kalenderjaar. */
export function getUsedLeaveDays(
  requests: LeaveRequest[],
  userId: string,
  year: number,
): number {
  return requests
    .filter((r) => r.userId === userId && r.status === 'approved' && DEDUCTED_LEAVE_TYPES.includes(r.type))
    .reduce((total, r) => total + countLeaveDays(r.startDate, r.endDate, year), 0);
}

export interface LeaveBalance {
  total: number;
  used: number;
  remaining: number;
  year: number;
}

/** Berekent het verlofsaldo van een gebruiker voor een kalenderjaar (standaard het lopende jaar). */
export function getLeaveBalance(
  user: Pick<User, 'id' | 'leaveBalanceTotal'>,
  requests: LeaveRequest[],
  year: number = new Date().getFullYear(),
): LeaveBalance {
  const total = getLeaveEntitlement(user);
  const used = getUsedLeaveDays(requests, user.id, year);
  return { total, used, remaining: total - used, year };
}
