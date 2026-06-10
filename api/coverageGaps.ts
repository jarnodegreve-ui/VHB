/**
 * Pure dekking/gaten-helpers — API-lokaal (geen cross-import uit ../src).
 * Houd in sync met src/lib/coverageGaps.ts (door tests gedekt).
 */

export const normalizeCode = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * Bepaal het dag-type van een planning-rij. Gebruik het expliciete dag-type
 * uit de import (kolom B) als dat is ingevuld; val anders terug op een
 * afleiding uit de datum: weekdag / zaterdag / zondag. Zo werkt de
 * dekkings-instelling ook wanneer de planning "zonder kopjes" is ingelezen
 * (dan is day_type leeg voor elke rij). Houd in sync met src/lib/coverageGaps.ts.
 */
export function resolveDayType(rawDayType: unknown, sourceDate: string): string {
  const explicit = String(rawDayType ?? "").trim();
  if (explicit) return explicit;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(sourceDate ?? "").trim());
  if (!m) return "";
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  if (dow === 0) return "zondag";
  if (dow === 6) return "zaterdag";
  return "weekdag";
}

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
