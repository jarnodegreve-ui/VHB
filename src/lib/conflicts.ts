import type { LeaveRequest, Shift } from '../types';

/**
 * Conflict-detectie: een chauffeur die op verlof staat (status='approved') maar
 * tóch ingepland is voor een rit op diezelfde dag — dat is bijna altijd een
 * import-fout uit Excel of een vergeten verlofaanvraag.
 *
 * Returns een array met alle conflicten. Eén shift kan in principe maar één
 * keer overlappen met één verlof, maar als er meerdere overlappende verlof-
 * aanvragen zijn (bv. half-dag-systeem in de toekomst) worden ze allemaal
 * geretourneerd.
 *
 * Performance: O(shifts * leaves) — acceptabel voor de huidige schaal (~30
 * chauffeurs × ~30 dagen = ~1000 shifts × ~50 verlofdagen). Mocht dit ooit
 * problematisch worden: groepeer leaves per userId in een Map.
 */
export interface ShiftLeaveConflict {
  shiftId: string;
  leaveId: string;
  userId: string;
  date: string;
}

const dateIsInRange = (date: string, start: string, end: string): boolean =>
  date >= start && date <= end;

export function detectShiftLeaveConflicts(
  shifts: Shift[],
  leaves: LeaveRequest[],
  options?: { onlyApproved?: boolean },
): ShiftLeaveConflict[] {
  const onlyApproved = options?.onlyApproved ?? true;
  const relevantLeaves = leaves.filter((l) => {
    if (l.status === 'rejected' || l.status === 'cancelled') return false;
    if (onlyApproved && l.status !== 'approved') return false;
    return true;
  });

  // Indexeer verlofaanvragen per gebruiker — scheelt scans bij grote shift-sets
  const leavesByUser = new Map<string, LeaveRequest[]>();
  for (const leave of relevantLeaves) {
    const list = leavesByUser.get(leave.userId);
    if (list) list.push(leave);
    else leavesByUser.set(leave.userId, [leave]);
  }

  const conflicts: ShiftLeaveConflict[] = [];
  for (const shift of shifts) {
    const userLeaves = leavesByUser.get(shift.driverId);
    if (!userLeaves) continue;
    for (const leave of userLeaves) {
      if (dateIsInRange(shift.date, leave.startDate, leave.endDate)) {
        conflicts.push({
          shiftId: shift.id,
          leaveId: leave.id,
          userId: shift.driverId,
          date: shift.date,
        });
      }
    }
  }
  return conflicts;
}

/** Verzameling shift-IDs die een conflict hebben — handig voor O(1) lookup in render-loops. */
export function shiftIdsWithConflict(
  shifts: Shift[],
  leaves: LeaveRequest[],
  options?: { onlyApproved?: boolean },
): Set<string> {
  const conflicts = detectShiftLeaveConflicts(shifts, leaves, options);
  return new Set(conflicts.map((c) => c.shiftId));
}


/**
 * Voor een specifieke verlofaanvraag: vind alle shifts van deze chauffeur die
 * binnen de verlofperiode vallen. Gebruikt door verlof-beheer om te tonen wat
 * concreet conflicteert vóór goedkeuring.
 */
export function shiftsConflictingWithLeave(shifts: Shift[], leave: LeaveRequest): Shift[] {
  return shifts.filter(
    (s) => s.driverId === leave.userId && dateIsInRange(s.date, leave.startDate, leave.endDate),
  );
}
