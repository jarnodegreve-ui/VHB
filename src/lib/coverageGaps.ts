/**
 * Pure helpers voor dekking/gaten — geen browser/Node-afhankelijkheden,
 * zodat zowel de server als unit-tests ze gebruiken.
 *
 * Een "gat" = een verwachte dienst (per dag-type ingesteld) die op een
 * concrete dag door niemand is ingevuld in de planning-matrix.
 */

export const normalizeCode = (v: unknown) => String(v ?? '').trim().toLowerCase();

/**
 * Standaard dag-types + standaard weekdag-toewijzing, gebruikt als de planner
 * nog niets zelf ingesteld heeft. dow-index: 0=zondag .. 6=zaterdag.
 */
export const DEFAULT_DAY_TYPES = ['schooldag', 'vakantie', 'zaterdag', 'zondag'] as const;
export const DEFAULT_WEEKDAYS: string[] = ['zondag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'schooldag', 'zaterdag'];

/** Een uitzondering: binnen [from,to] (yyyy-mm-dd, inclusief) geldt `dayType`. */
export type DayTypeOverride = { from: string; to: string; dayType: string };

/** Encodeer een uitzondering als opslag-string "from..to|dagtype". */
export function encodeOverride(o: DayTypeOverride): string {
  const from = o.from <= o.to ? o.from : o.to;
  const to = o.from <= o.to ? o.to : o.from;
  return `${from}..${to}|${o.dayType}`;
}

/** Parse uitzonderingen uit opgeslagen strings "from..to|dagtype". */
export function parseOverrides(raw: unknown): DayTypeOverride[] {
  if (!Array.isArray(raw)) return [];
  const out: DayTypeOverride[] = [];
  for (const item of raw) {
    const s = String(item ?? '').trim();
    const bar = s.lastIndexOf('|');
    if (bar < 0) continue;
    const dayType = s.slice(bar + 1).trim();
    const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(s.slice(0, bar));
    if (!m || !dayType) continue;
    const [, a, b] = m;
    out.push({ from: a <= b ? a : b, to: a <= b ? b : a, dayType });
  }
  return out;
}

/** Weekdag-toewijzing met ingangsdatum: vanaf `vanaf` (yyyy-mm-dd) geldt deze
 *  toewijzing i.p.v. de basis — bv. het schooljaar-regime vanaf 1 september.
 *  Opgeslagen als reserved key "__weekdagen_<vanaf>__" naast "__weekdagen__".
 *  Houd in sync met api/coverageGaps.ts. */
export type WeekdagPeriode = { vanaf: string; weekdays: string[] };

export const WEEKDAY_PERIOD_KEY_RE = /^__weekdagen_(\d{4}-\d{2}-\d{2})__$/;
export const encodeWeekdagPeriodeKey = (vanaf: string): string => `__weekdagen_${vanaf}__`;

/** De geldende weekdag-toewijzing voor een datum: de periode met de laatste
 *  ingangsdatum ≤ datum wint; zonder passende periode geldt de basis. */
export function weekdaysVoorDatum(basis: string[], perioden: WeekdagPeriode[], datum: string): string[] {
  let keuze = basis;
  let besteVanaf = '';
  for (const p of perioden) {
    if (!Array.isArray(p.weekdays) || p.weekdays.length !== 7) continue;
    if (p.vanaf <= datum && p.vanaf > besteVanaf) {
      keuze = p.weekdays;
      besteVanaf = p.vanaf;
    }
  }
  return keuze;
}

/**
 * Bepaal het dag-type van een planning-rij:
 *   1. Expliciet dag-type uit de import (kolom B) wint altijd.
 *   2. Anders: een uitzondering waarvan [from,to] de datum bevat.
 *   3. Anders: het standaard dag-type voor die weekdag (weekdays[dow]).
 * Datum als yyyy-mm-dd; UTC zodat er geen tijdzone-drift op de weekdag zit.
 */
export function resolveDayType(
  rawDayType: unknown,
  sourceDate: string,
  weekdays: string[] = [],
  overrides: DayTypeOverride[] = [],
): string {
  const explicit = String(rawDayType ?? '').trim();
  if (explicit) return explicit;
  const iso = String(sourceDate ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return '';
  for (const o of overrides) {
    if (iso >= o.from && iso <= o.to) return o.dayType;
  }
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  return String(weekdays[dow] ?? '').trim();
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
  /** Per opengevallen dienst (genormaliseerde code): wie viel uit en waarom.
   *  Alleen gevuld als het gat door een goedgekeurde afwezigheid komt —
   *  een dienst die nooit toegewezen was, heeft geen uitval-info. */
  uitval?: Record<string, { name: string; reason: string }>;
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
