import { apiFetch } from './api';

/**
 * Read-only maandplanning — de geïmporteerde planning-matrix (chauffeur ×
 * datum met codes) zoals die in het chauffeurslokaal hangt. De server
 * resolved per cel het type, hier tonen we 't enkel.
 */
export type CellKind = 'service' | 'absence' | 'leave' | 'training' | 'unknown';

export type MonthCell = {
  code: string;
  kind: CellKind;
  /** mensleesbaar label, bv. "Dienst 4101" of de omschrijving van een code */
  label: string;
  /** uren-segmenten "HH:MM - HH:MM" (enkel bij diensten, anders leeg) */
  segments: string[];
};

export type MonthPlanning = {
  month: string;
  /** datums (yyyy-mm-dd) die een planning-rij hebben deze maand, oplopend */
  dates: string[];
  /** actieve chauffeurs, op naam gesorteerd */
  drivers: { id: string; name: string }[];
  /** cells[driverId][date] = { code, kind } — alleen niet-lege cellen */
  cells: Record<string, Record<string, MonthCell>>;
};

export function fetchMonthPlanning(month: string): Promise<MonthPlanning> {
  return apiFetch<MonthPlanning>(`/api/month-planning?month=${month}`);
}
