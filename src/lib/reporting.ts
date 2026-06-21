import type { LeaveRequest, Shift, User } from '../types';
import { verlofBalans } from './leaveBalance';
import { analyzeCompliance } from './compliance';

/**
 * Management-rapportage: aggregeert de bestaande planning-, verlof- en
 * gebruikersdata tot één overzicht per chauffeur over een gekozen periode.
 * Pure functie (geen I/O) zodat ze los testbaar is; de view en de
 * Excel-export delen hetzelfde resultaat.
 */

export type ReportPeriod = { year: number; month: number | null };

export type DriverReportRow = {
  driverId: string;
  name: string;
  employeeId: string;
  shiftsCount: number;
  workedMinutes: number;
  workedHoursLabel: string;
  betaaldGebruikt: number;
  betaaldResterend: number;
  betaaldBudget: number;
  kleinVerlet: number;
  violations: number;
  warnings: number;
};

const parseTimeToMinutes = (time: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
};

/** Dienstduur in minuten; nachtdiensten (einde ≤ start) lopen door tot de
 *  volgende dag, net als in de rusttijdcontrole. */
export const shiftDurationMinutes = (shift: Shift): number => {
  const start = parseTimeToMinutes(shift.startTime);
  const end = parseTimeToMinutes(shift.endTime);
  if (start === null || end === null) return 0;
  return end <= start ? end + 24 * 60 - start : end - start;
};

const formatHours = (minutes: number): string => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h}u` : `${h}u${String(m).padStart(2, '0')}`;
};

/** yyyy-mm-dd valt binnen de periode (jaar + optioneel maand 1–12). */
const inPeriod = (iso: string, period: ReportPeriod): boolean => {
  if (!iso || iso.length < 7) return false;
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  if (year !== period.year) return false;
  if (period.month !== null && month !== period.month) return false;
  return true;
};

export function buildDriverReport(
  shifts: Shift[],
  leave: LeaveRequest[],
  users: User[],
  period: ReportPeriod,
): DriverReportRow[] {
  // Alleen chauffeurs in het rapport — planners/admins rijden geen diensten.
  const drivers = users.filter((u) => u.role === 'chauffeur');

  const periodShifts = shifts.filter((s) => inPeriod(s.date, period));

  // Rusttijd-analyse op een verbreed venster (±8 dagen rond de periode) zodat
  // week-/rusttijd-overtredingen over de periodegrens niet gemist worden;
  // daarna houden we alleen findings binnen de periode zelf (consistent met
  // ComplianceView). De diensten/uren-telling blijft op periodShifts.
  const pad = (n: number) => String(n).padStart(2, '0');
  const shiftIso = (iso: string, days: number) =>
    new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + days))
      .toISOString().slice(0, 10);
  const startIso = period.month === null ? `${period.year}-01-01` : `${period.year}-${pad(period.month)}-01`;
  const endIso = period.month === null
    ? `${period.year}-12-31`
    : `${period.year}-${pad(period.month)}-${pad(new Date(Date.UTC(period.year, period.month, 0)).getUTCDate())}`;
  const widenStart = shiftIso(startIso, -8);
  const widenEnd = shiftIso(endIso, 8);
  const widenedShifts = shifts.filter((s) => s.date >= widenStart && s.date <= widenEnd);
  const compliance = analyzeCompliance(widenedShifts);

  const shiftsByDriver = new Map<string, Shift[]>();
  for (const s of periodShifts) {
    const list = shiftsByDriver.get(String(s.driverId)) ?? [];
    list.push(s);
    shiftsByDriver.set(String(s.driverId), list);
  }

  const rows = drivers.map((driver): DriverReportRow => {
    const driverShifts = shiftsByDriver.get(String(driver.id)) ?? [];
    const workedMinutes = driverShifts.reduce((sum, s) => sum + shiftDurationMinutes(s), 0);
    const balance = verlofBalans(leave, driver.id, period.year, driver.verlofBudget);
    const findings = compliance.perDriver.get(String(driver.id)) ?? [];
    return {
      driverId: String(driver.id),
      name: driver.name,
      employeeId: driver.employeeId || '',
      shiftsCount: driverShifts.length,
      workedMinutes,
      workedHoursLabel: formatHours(workedMinutes),
      betaaldGebruikt: balance.betaaldGebruikt,
      betaaldResterend: balance.betaaldResterend,
      betaaldBudget: balance.betaaldBudget,
      kleinVerlet: balance.kleinVerletDagen,
      violations: findings.filter((f) => f.severity === 'violation').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
    };
  });

  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

export const MONTH_LABELS = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

export const periodLabel = (period: ReportPeriod): string =>
  period.month === null ? `${period.year}` : `${MONTH_LABELS[period.month - 1]} ${period.year}`;
