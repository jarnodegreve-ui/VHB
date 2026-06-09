/**
 * Pure helpers voor dekking/gaten — geen browser/Node-afhankelijkheden,
 * zodat zowel de server als unit-tests ze gebruiken.
 *
 * Een "gat" = een verwachte dienst (per dag-type ingesteld) die op een
 * concrete dag door niemand is ingevuld in de planning-matrix.
 */

export const normalizeCode = (v: unknown) => String(v ?? '').trim().toLowerCase();

export type DayGap = {
  date: string;
  dayType: string;
  /** aantal verwachte diensten voor dit dag-type */
  expected: number;
  /** hoeveel daarvan ingevuld zijn */
  covered: number;
  /** dienstnummers die ontbreken (niet toegekend die dag) */
  missing: string[];
};

/** Bereken ontbrekende diensten voor één dag. */
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
