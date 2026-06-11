/**
 * Pure dekking/gaten-helpers — API-lokaal (geen cross-import uit ../src).
 * Houd in sync met src/lib/coverageGaps.ts (door tests gedekt).
 */

export const normalizeCode = (v: unknown) => String(v ?? "").trim().toLowerCase();

/** Standaard dag-types + weekdag-toewijzing (dow 0=zondag..6=zaterdag). */
export const DEFAULT_DAY_TYPES = ["schooldag", "vakantie", "zaterdag", "zondag"] as const;
export const DEFAULT_WEEKDAYS: string[] = ["zondag", "schooldag", "schooldag", "schooldag", "schooldag", "schooldag", "zaterdag"];

/** Een uitzondering: binnen [from,to] (yyyy-mm-dd, inclusief) geldt `dayType`. */
export type DayTypeOverride = { from: string; to: string; dayType: string };

export function encodeOverride(o: DayTypeOverride): string {
  const from = o.from <= o.to ? o.from : o.to;
  const to = o.from <= o.to ? o.to : o.from;
  return `${from}..${to}|${o.dayType}`;
}

export function parseOverrides(raw: unknown): DayTypeOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: DayTypeOverride[] = [];
  for (const item of raw) {
    const s = String(item ?? "").trim();
    const bar = s.lastIndexOf("|");
    if (bar < 0) continue;
    const dayType = s.slice(bar + 1).trim();
    const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(s.slice(0, bar));
    if (!m || !dayType) continue;
    const [, a, b] = m;
    out.push({ from: a <= b ? a : b, to: a <= b ? b : a, dayType });
  }
  return out;
}

/**
 * Bepaal het dag-type van een planning-rij: 1) expliciet uit de import wint;
 * 2) een uitzondering die de datum bevat; 3) het standaard dag-type voor die
 * weekdag (weekdays[dow]). Houd in sync met src/lib/coverageGaps.ts.
 */
export function resolveDayType(
  rawDayType: unknown,
  sourceDate: string,
  weekdays: string[] = [],
  overrides: DayTypeOverride[] = [],
): string {
  const explicit = String(rawDayType ?? "").trim();
  if (explicit) return explicit;
  const iso = String(sourceDate ?? "").trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  for (const o of overrides) {
    if (iso >= o.from && iso <= o.to) return o.dayType;
  }
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return String(weekdays[dow] ?? "").trim();
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
