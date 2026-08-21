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

/** Waar komt het dag-type van een dag vandaan? Voedt de uitleg op de dekking
 *  ("waarom is dit een schooldag?") — scheelt debuggen bij elke
 *  dienstregelingswissel. Houd in sync met api/coverageGaps.ts. */
export type DayTypeBron =
  | { soort: 'excel' }
  | { soort: 'uitzondering'; from: string; to: string }
  | { soort: 'periode'; vanaf: string }
  | { soort: 'basis' }
  | { soort: 'geen' };

/** Zelfde beslisregels als resolveDayType, maar mét de herkomst erbij. */
export function resolveDayTypeMetBron(
  rawDayType: unknown,
  sourceDate: string,
  basisWeekdays: string[] = [],
  perioden: WeekdagPeriode[] = [],
  overrides: DayTypeOverride[] = [],
): { dayType: string; bron: DayTypeBron } {
  const explicit = String(rawDayType ?? '').trim();
  if (explicit) return { dayType: explicit, bron: { soort: 'excel' } };
  const iso = String(sourceDate ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return { dayType: '', bron: { soort: 'geen' } };
  for (const o of overrides) {
    if (iso >= o.from && iso <= o.to) {
      return { dayType: o.dayType, bron: { soort: 'uitzondering', from: o.from, to: o.to } };
    }
  }
  const dow = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
  let keuze = basisWeekdays;
  let besteVanaf = '';
  for (const p of perioden) {
    if (!Array.isArray(p.weekdays) || p.weekdays.length !== 7) continue;
    if (p.vanaf <= iso && p.vanaf > besteVanaf) {
      keuze = p.weekdays;
      besteVanaf = p.vanaf;
    }
  }
  const dayType = String(keuze[dow] ?? '').trim();
  if (!dayType) return { dayType: '', bron: { soort: 'geen' } };
  return { dayType, bron: besteVanaf ? { soort: 'periode', vanaf: besteVanaf } : { soort: 'basis' } };
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
  /** Herkomst van het dag-type (uitleg-tooltip); ouder cachemateriaal mist dit veld. */
  bron?: DayTypeBron;
};

/** Eén dag-type waarvan de verwachtingslijst niet spoort met wat er in de
 *  planning-matrix echt gereden wordt. `nooitGereden` = verwacht maar op geen
 *  enkele dag van dit type aanwezig (structureel fantoom-gat, zoals 2114 op
 *  dinsdag na de schooljaarswissel); `nietVerwacht` = dienst-achtige code die
 *  op minstens de helft van de dagen gereden wordt maar niet in de lijst
 *  staat (zoals 2515/2517 op vrijdag). */
export type VerwachtingAfwijking = {
  dayType: string;
  dagen: number;
  nooitGereden: string[];
  nietVerwacht: Array<{ code: string; dagen: number }>;
};

/** Vergelijk de verwachtingslijsten met de praktijk in de matrix-rijen.
 *  Alleen cijfercodes (3-4 cijfers) tellen als "gereden maar niet verwacht" —
 *  vrij/ziek/EEK-codes zouden de lijst anders vervuilen. */
export function vergelijkVerwachtingenMetPraktijk(
  rows: Array<{ source_date?: unknown; day_type?: unknown; assignments?: unknown }>,
  expectationsByDayType: Record<string, string[]>,
  basisWeekdays: string[],
  perioden: WeekdagPeriode[],
  overrides: DayTypeOverride[],
): VerwachtingAfwijking[] {
  const DIENSTCODE_RE = /^\d{3,4}$/;
  const perType = new Map<string, { dagen: number; aanwezig: Map<string, number>; extra: Map<string, number> }>();
  for (const r of rows) {
    const date = String(r.source_date ?? '');
    const dayType = resolveDayType(r.day_type, date, weekdaysVoorDatum(basisWeekdays, perioden, date), overrides);
    if (!dayType) continue;
    const expected = expectationsByDayType[dayType];
    if (!Array.isArray(expected) || expected.length === 0) continue;
    const expectedSet = new Set(expected.map(normalizeCode));
    let entry = perType.get(dayType);
    if (!entry) {
      entry = { dagen: 0, aanwezig: new Map(), extra: new Map() };
      perType.set(dayType, entry);
    }
    entry.dagen += 1;
    const assignments = r.assignments && typeof r.assignments === 'object' && !Array.isArray(r.assignments)
      ? (r.assignments as Record<string, unknown>)
      : {};
    const opDezeDag = new Set<string>();
    for (const v of Object.values(assignments)) {
      const code = normalizeCode(v);
      if (!code || opDezeDag.has(code)) continue;
      opDezeDag.add(code);
      if (expectedSet.has(code)) entry.aanwezig.set(code, (entry.aanwezig.get(code) ?? 0) + 1);
      else if (DIENSTCODE_RE.test(code)) entry.extra.set(code, (entry.extra.get(code) ?? 0) + 1);
    }
  }
  const out: VerwachtingAfwijking[] = [];
  for (const [dayType, e] of perType) {
    const expected = expectationsByDayType[dayType] ?? [];
    const seen = new Set<string>();
    const nooitGereden: string[] = [];
    for (const s of expected) {
      const key = normalizeCode(s);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (!e.aanwezig.has(key)) nooitGereden.push(s);
    }
    const drempel = Math.max(1, Math.ceil(e.dagen / 2));
    const nietVerwacht = [...e.extra.entries()]
      .filter(([, dagen]) => dagen >= drempel)
      .map(([code, dagen]) => ({ code, dagen }))
      .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
    if (nooitGereden.length > 0 || nietVerwacht.length > 0) {
      out.push({ dayType, dagen: e.dagen, nooitGereden, nietVerwacht });
    }
  }
  return out.sort((a, b) => a.dayType.localeCompare(b.dayType));
}

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
