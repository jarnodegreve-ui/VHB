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
  // Dedupe op genormaliseerde sleutel (en negeer lege entries) zodat een
  // dubbel ingestelde verwachting niet dubbel telt; bewaar wel de originele
  // schrijfwijze voor weergave. Houd in sync met src/lib/coverageGaps.ts.
  const seen = new Set<string>();
  const expectedUnique: string[] = [];
  for (const s of expectedServiceNumbers) {
    const key = normalizeCode(s);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    expectedUnique.push(s);
  }
  const missing = expectedUnique.filter((s) => !assigned.has(normalizeCode(s)));
  return {
    date,
    dayType,
    expected: expectedUnique.length,
    covered: expectedUnique.length - missing.length,
    missing,
  };
}
