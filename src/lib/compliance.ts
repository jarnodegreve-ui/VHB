import type { Shift } from '../types';

/**
 * Rij- en rusttijdcontrole op de geïmporteerde planning.
 *
 * Regels geënt op EU 561/2006 en het KB van 10/08/2005 (geregeld vervoer),
 * toegepast op wat de planning wéét: dienst-spans per dag. Tachograafdata
 * (effectieve rijtijd, pauzes) zit hier niet in — de controle is dus een
 * planningssignaal, geen juridisch sluitend bewijs. Conservatief gekozen:
 * de dienstduur geldt als bovengrens van de werktijd.
 *
 * Gecontroleerd per chauffeur:
 *  - dagelijkse rust tussen diensten: ≥ 11u (verkort ≥ 9u, max 3×/week)
 *  - wekelijkse rust (ma–zo): één aaneengesloten periode ≥ 45u
 *    (verkort 24–45u = waarschuwing, < 24u = overtreding)
 *  - amplitude per dag (eerste start → laatste einde): ≤ 14u
 *  - werktijd per dag (som dienstduur): > 12u overtreding, > 10u waarschuwing
 *  - aaneengesloten werkdagen: > 6 dagen zonder vrije dag
 */

export type ComplianceSeverity = 'violation' | 'warning';

export type ComplianceFinding = {
  rule: 'dagelijkse-rust' | 'wekelijkse-rust' | 'amplitude' | 'dagelijkse-werktijd' | 'werkdagen-op-rij';
  severity: ComplianceSeverity;
  driverId: string;
  /** ISO-datum waarop (of vanaf waar) het probleem speelt. */
  date: string;
  message: string;
};

const MIN_DAILY_REST_H = 11;
const REDUCED_DAILY_REST_H = 9;
const MAX_REDUCED_RESTS_PER_WEEK = 3;
const STANDARD_WEEKLY_REST_H = 45;
const REDUCED_WEEKLY_REST_H = 24;
const MAX_AMPLITUDE_H = 14;
const MAX_DAILY_WORK_H = 12; // Vlaanderen, geregeld vervoer (KB 10/08/2005)
const WARN_DAILY_WORK_H = 10;
const MAX_CONSECUTIVE_WORKDAYS = 6;

const MS_PER_H = 3_600_000;
const MS_PER_DAY = 24 * MS_PER_H;

const parseTimeToMinutes = (time: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
};

type Span = { start: number; end: number; date: string };

/** Dienst → absolute ms-span (UTC-basis; DST speelt geen rol omdat alles
 *  relatief binnen dezelfde tijdlijn vergeleken wordt). Nachtdiensten
 *  (einde ≤ start) lopen door tot de volgende dag. */
const toSpan = (shift: Shift): Span | null => {
  const startMin = parseTimeToMinutes(shift.startTime);
  const endMin = parseTimeToMinutes(shift.endTime);
  const dayMs = Date.parse(`${shift.date}T00:00:00Z`);
  if (startMin === null || endMin === null || Number.isNaN(dayMs)) return null;
  const start = dayMs + startMin * 60_000;
  let end = dayMs + endMin * 60_000;
  if (end <= start) end += MS_PER_DAY;
  return { start, end, date: shift.date };
};

const fmtH = (ms: number) => {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}u` : `${h}u${String(m).padStart(2, '0')}`;
};

const formatDate = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
};

/** ISO-weeknummer-sleutel (maandag als weekstart) voor groepering ma–zo. */
const mondayKeyOf = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7; // ma=0 ... zo=6
  d.setUTCDate(d.getUTCDate() - weekday);
  return d.toISOString().slice(0, 10);
};

export const analyzeDriverCompliance = (driverId: string, shifts: Shift[]): ComplianceFinding[] => {
  const findings: ComplianceFinding[] = [];
  const spans = shifts
    .filter((s) => String(s.driverId) === String(driverId))
    .map(toSpan)
    .filter((s): s is Span => s !== null)
    .sort((a, b) => a.start - b.start);
  if (spans.length === 0) return findings;

  // --- per dag: amplitude + totale werktijd ---
  const byDate = new Map<string, Span[]>();
  for (const span of spans) {
    const list = byDate.get(span.date) ?? [];
    list.push(span);
    byDate.set(span.date, list);
  }
  for (const [date, daySpans] of byDate) {
    const first = Math.min(...daySpans.map((s) => s.start));
    const last = Math.max(...daySpans.map((s) => s.end));
    const amplitude = last - first;
    if (amplitude > MAX_AMPLITUDE_H * MS_PER_H) {
      findings.push({
        rule: 'amplitude',
        severity: 'violation',
        driverId,
        date,
        message: `Amplitude van ${fmtH(amplitude)} op ${formatDate(date)} (max ${MAX_AMPLITUDE_H}u tussen eerste start en laatste einde).`,
      });
    }
    const work = daySpans.reduce((sum, s) => sum + (s.end - s.start), 0);
    if (work > MAX_DAILY_WORK_H * MS_PER_H) {
      findings.push({
        rule: 'dagelijkse-werktijd',
        severity: 'violation',
        driverId,
        date,
        message: `${fmtH(work)} dienst op ${formatDate(date)} — boven het maximum van ${MAX_DAILY_WORK_H}u.`,
      });
    } else if (work > WARN_DAILY_WORK_H * MS_PER_H) {
      findings.push({
        rule: 'dagelijkse-werktijd',
        severity: 'warning',
        driverId,
        date,
        message: `${fmtH(work)} dienst op ${formatDate(date)} — lang (boven ${WARN_DAILY_WORK_H}u), controleer pauzes.`,
      });
    }
  }

  // --- tussen opeenvolgende werkdagen: dagelijkse rust ---
  const dates = [...byDate.keys()].sort();
  const reducedRestsPerWeek = new Map<string, number>();
  for (let i = 1; i < dates.length; i++) {
    const prevSpans = byDate.get(dates[i - 1])!;
    const currSpans = byDate.get(dates[i])!;
    const prevEnd = Math.max(...prevSpans.map((s) => s.end));
    const currStart = Math.min(...currSpans.map((s) => s.start));
    const gapDays = Math.round((Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)) / MS_PER_DAY);
    if (gapDays !== 1) continue; // alleen direct opeenvolgende werkdagen
    const rest = currStart - prevEnd;
    if (rest < REDUCED_DAILY_REST_H * MS_PER_H) {
      findings.push({
        rule: 'dagelijkse-rust',
        severity: 'violation',
        driverId,
        date: dates[i],
        message: `Slechts ${fmtH(Math.max(rest, 0))} rust tussen ${formatDate(dates[i - 1])} en ${formatDate(dates[i])} (minimum ${REDUCED_DAILY_REST_H}u, zelfs verkort).`,
      });
    } else if (rest < MIN_DAILY_REST_H * MS_PER_H) {
      const weekKey = mondayKeyOf(dates[i]);
      const count = (reducedRestsPerWeek.get(weekKey) ?? 0) + 1;
      reducedRestsPerWeek.set(weekKey, count);
      if (count > MAX_REDUCED_RESTS_PER_WEEK) {
        findings.push({
          rule: 'dagelijkse-rust',
          severity: 'violation',
          driverId,
          date: dates[i],
          message: `${count}e verkorte dagelijkse rust (<${MIN_DAILY_REST_H}u) in de week van ${formatDate(weekKey)} — maximum is ${MAX_REDUCED_RESTS_PER_WEEK} per week.`,
        });
      } else {
        findings.push({
          rule: 'dagelijkse-rust',
          severity: 'warning',
          driverId,
          date: dates[i],
          message: `Verkorte rust van ${fmtH(rest)} tussen ${formatDate(dates[i - 1])} en ${formatDate(dates[i])} (${count}/${MAX_REDUCED_RESTS_PER_WEEK} deze week).`,
        });
      }
    }
  }

  // --- aaneengesloten werkdagen ---
  let streak = 1;
  for (let i = 1; i < dates.length; i++) {
    const gapDays = Math.round((Date.parse(`${dates[i]}T00:00:00Z`) - Date.parse(`${dates[i - 1]}T00:00:00Z`)) / MS_PER_DAY);
    streak = gapDays === 1 ? streak + 1 : 1;
    if (streak === MAX_CONSECUTIVE_WORKDAYS + 1) {
      findings.push({
        rule: 'werkdagen-op-rij',
        severity: 'violation',
        driverId,
        date: dates[i],
        message: `${streak} werkdagen op rij t/m ${formatDate(dates[i])} — na ${MAX_CONSECUTIVE_WORKDAYS} dagen is wekelijkse rust verplicht.`,
      });
    }
  }

  // --- wekelijkse rust (ma–zo): langste aaneengesloten dienstvrije periode ---
  const byWeek = new Map<string, Span[]>();
  for (const span of spans) {
    const key = mondayKeyOf(span.date);
    const list = byWeek.get(key) ?? [];
    list.push(span);
    byWeek.set(key, list);
  }
  for (const [weekKey, weekSpans] of byWeek) {
    const weekStart = Date.parse(`${weekKey}T00:00:00Z`);
    const weekEnd = weekStart + 7 * MS_PER_DAY;
    // Voor de randen tellen ook de laatste dienst vóór en eerste ná de week.
    // prevEnd ankert op de laatste dienst die VÓÓR weekStart begint (op start
    // filteren, niet op end): een nachtdienst die zondag start en maandag over
    // de weekgrens eindigt telt zo correct mee als bezetting i.p.v. als rust —
    // anders werd zo'n bridge-dienst weggefilterd en bleef een echte
    // rusttijdschending vals-groen.
    const prevEnd = Math.max(weekStart - 7 * MS_PER_DAY, ...spans.filter((s) => s.start < weekStart).map((s) => s.end));
    const nextStart = Math.min(weekEnd + 7 * MS_PER_DAY, ...spans.filter((s) => s.start >= weekEnd).map((s) => s.start));
    const sorted = [...weekSpans].sort((a, b) => a.start - b.start);
    let longestRest = Math.max(0, sorted[0].start - prevEnd);
    for (let i = 1; i < sorted.length; i++) {
      longestRest = Math.max(longestRest, sorted[i].start - sorted[i - 1].end);
    }
    longestRest = Math.max(longestRest, Math.max(nextStart, sorted[sorted.length - 1].end) - sorted[sorted.length - 1].end);

    if (longestRest < REDUCED_WEEKLY_REST_H * MS_PER_H) {
      findings.push({
        rule: 'wekelijkse-rust',
        severity: 'violation',
        driverId,
        date: weekKey,
        message: `Langste rustblok in de week van ${formatDate(weekKey)} is ${fmtH(longestRest)} — minder dan de verkorte wekelijkse rust van ${REDUCED_WEEKLY_REST_H}u.`,
      });
    } else if (longestRest < STANDARD_WEEKLY_REST_H * MS_PER_H) {
      findings.push({
        rule: 'wekelijkse-rust',
        severity: 'warning',
        driverId,
        date: weekKey,
        message: `Verkorte wekelijkse rust van ${fmtH(longestRest)} in de week van ${formatDate(weekKey)} (norm ${STANDARD_WEEKLY_REST_H}u) — compensatie vereist.`,
      });
    }
  }

  return findings.sort((a, b) => a.date.localeCompare(b.date));
};

export type ComplianceReport = {
  perDriver: Map<string, ComplianceFinding[]>;
  violations: number;
  warnings: number;
};

export const analyzeCompliance = (shifts: Shift[]): ComplianceReport => {
  const driverIds = [...new Set(shifts.map((s) => String(s.driverId)))];
  const perDriver = new Map<string, ComplianceFinding[]>();
  let violations = 0;
  let warnings = 0;
  for (const driverId of driverIds) {
    const findings = analyzeDriverCompliance(driverId, shifts);
    if (findings.length > 0) perDriver.set(driverId, findings);
    violations += findings.filter((f) => f.severity === 'violation').length;
    warnings += findings.filter((f) => f.severity === 'warning').length;
  }
  return { perDriver, violations, warnings };
};
