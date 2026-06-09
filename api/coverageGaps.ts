/**
 * Pure dekking/gaten-helpers — API-lokaal (geen cross-import uit ../src).
 * Houd in sync met src/lib/coverageGaps.ts (door tests gedekt).
 */

export const normalizeCode = (v: unknown) => String(v ?? "").trim().toLowerCase();

export type DayGap = {
  date: string;
  dayType: string;
  expected: number;
  covered: number;
  missing: string[];
};

export function computeDayGap(
  date: string,
  dayType: string,
  expectedServiceNumbers: string[],
  assignmentValues: string[],
): DayGap {
  const assigned = new Set(assignmentValues.map(normalizeCode));
  const missing = expectedServiceNumbers.filter((s) => !assigned.has(normalizeCode(s)));
  return {
    date,
    dayType,
    expected: expectedServiceNumbers.length,
    covered: expectedServiceNumbers.length - missing.length,
    missing,
  };
}
