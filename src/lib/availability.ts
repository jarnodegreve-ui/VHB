import { apiFetch } from './api';

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
};

export type AvailabilityResponse = {
  from: string;
  to: string;
  drivers: AvailabilityDriver[];
  days: AvailabilityDay[];
};

export function fetchAvailability(from: string, to: string): Promise<AvailabilityResponse> {
  return apiFetch<AvailabilityResponse>(`/api/availability?from=${from}&to=${to}`);
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

/** Maandag van de week waarin `d` valt (week begint maandag). */
export const mondayOf = (d: Date): Date => {
  const out = new Date(d);
  const jsDay = out.getDay(); // 0=zo .. 6=za
  const diff = jsDay === 0 ? -6 : 1 - jsDay;
  out.setDate(out.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
};
