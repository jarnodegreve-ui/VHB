import { apiFetch } from './api';
import { LEAVE_TYPE_LABELS } from './format';
import type { LeaveRequest, Shift } from '../types';

/**
 * Beschikbaarheid per dag — opgehaald van /api/availability. De server
 * berekent per dag wie er rijdt, op verlof staat of vrij is (op basis van
 * planning + goedgekeurd verlof), zodat ook chauffeurs — die normaal enkel
 * hun eigen shifts zien — kunnen zien wie er vrij is om mee te ruilen.
 */
export type AvailabilityDriver = { id: string; name: string };

export type AvailabilityDay = {
  date: string;
  /** driver-ids die die dag een dienst hebben */
  working: string[];
  /** driver-ids met goedgekeurd verlof die dag */
  leave: string[];
  /** driver-ids zonder dienst én zonder verlof */
  free: string[];
  /** per werkende driver-id: het dienst-/lijnnummer (bv. "4101", of "4101/4103") */
  lines: Record<string, string>;
  /**
   * Enkel met `takeover: true` opgevraagd: driver-ids die die dag een dienst
   * mogen overnemen zónder tegenprestatie, met hun planningcode als waarde
   * ('vrij' | 'bv' | 'tk' | 'ta'). De server bepaalt de regel — de UI toont ze
   * alleen (en de server valideert opnieuw bij het indienen).
   */
  takeover?: Record<string, string>;
};

export type AvailabilityResponse = {
  from: string;
  to: string;
  drivers: AvailabilityDriver[];
  days: AvailabilityDay[];
};

export function fetchAvailability(
  from: string,
  to: string,
  opts: { takeover?: boolean } = {},
): Promise<AvailabilityResponse> {
  const takeover = opts.takeover ? '&takeover=1' : '';
  return apiFetch<AvailabilityResponse>(`/api/availability?from=${from}&to=${to}${takeover}`);
}

/** Drivers die zowel rijden als verlof hebben op dezelfde dag = conflict. */
export function conflictIds(day: AvailabilityDay): string[] {
  const leaveSet = new Set(day.leave);
  return day.working.filter((id) => leaveSet.has(id));
}

// --- Datum-helpers (lokale tijd, ISO yyyy-mm-dd) ---

export const isoDate = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const addDays = (d: Date, n: number): Date => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

/**
 * Diensten die nog op naam staan van een chauffeur die die dag goedgekeurd
 * afwezig is. Ziek melden (of verlof goedkeuren) haalt de dienst niet uit de
 * planning — die moet iemand anders rijden. Eén bron voor het dashboard-
 * signaal en de vervolgstap van de ziekmelding.
 *
 * `vanafIso` kapt het verleden af: een dienst van gisteren valt niet meer te
 * herverdelen. Geeft de dienst mét de reden van afwezigheid terug, oplopend
 * op datum.
 */
export type OpenstaandeDienst = Shift & { reden: string; redenType: LeaveRequest['type'] };

export function openstaandeDienstenVanAfwezigen(
  shifts: Shift[],
  leave: LeaveRequest[],
  vanafIso: string,
  opts?: { driverId?: string; totIso?: string },
): OpenstaandeDienst[] {
  const afwezig = leave.filter((l) => l.status === 'approved');
  const uit: OpenstaandeDienst[] = [];
  for (const s of shifts) {
    if (s.date < vanafIso) continue;
    if (opts?.totIso && s.date > opts.totIso) continue;
    if (opts?.driverId && String(s.driverId) !== String(opts.driverId)) continue;
    const reden = afwezig.find(
      (l) => String(l.userId) === String(s.driverId) && l.startDate <= s.date && l.endDate >= s.date,
    );
    if (!reden) continue;
    uit.push({ ...s, reden: LEAVE_TYPE_LABELS[reden.type] ?? 'Afwezig', redenType: reden.type });
  }
  return uit.sort((a, b) => a.date.localeCompare(b.date) || String(a.line).localeCompare(String(b.line)));
}
