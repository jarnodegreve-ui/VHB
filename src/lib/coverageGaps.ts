/**
 * Pure helpers voor dekking/gaten — geen browser/Node-afhankelijkheden,
 * zodat zowel de server als unit-tests ze gebruiken.
 *
 * Een "gat" = een verwachte dienst (per dag-type ingesteld) die op een
 * concrete dag door niemand is ingevuld in de planning-matrix.
 */

export const normalizeCode = (v: unknown) => String(v ?? '').trim().toLowerCase();

/**
 * Bepaal het dag-type van een planning-rij. Gebruik het expliciete dag-type
 * uit de import (kolom B) als dat is ingevuld; val anders terug op een
 * afleiding uit de datum: weekdag / zaterdag / zondag. Zo werkt de
 * dekkings-instelling ook wanneer de planning "zonder kopjes" is ingelezen
 * (dan is day_type leeg voor elke rij). Datum als yyyy-mm-dd; UTC zodat er
 * geen tijdzone-drift op de weekdag zit.
 */
export function resolveDayType(rawDayType: unknown, sourceDate: string): string {
  const explicit = String(rawDayType ?? '').trim();
  if (explicit) return explicit;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(sourceDate ?? '').trim());
  if (!m) return '';
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  if (dow === 0) return 'zondag';
  if (dow === 6) return 'zaterdag';
  return 'weekdag';
}

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
  // Dedupe op genormaliseerde sleutel (en negeer lege entries) zodat een
  // dubbel ingestelde verwachting niet dubbel telt; bewaar wel de originele
  // schrijfwijze voor weergave.
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
