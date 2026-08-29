import { apiJson } from './api';

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
  /** Dienstcode die door een afwezigheids-overlay (ziek/bv/kv) overdekt wordt.
   *  Ziek melden haalt de dienst niet uit de planning — hij staat nog op naam
   *  van deze chauffeur en moet herverdeeld worden. */
  hiddenService?: string;
  /** Deze cel is hier terechtgekomen door een doorgevoerde ruil/wissel — de
   *  planning wijkt dus af van de geïmporteerde Excel. */
  swapId?: string;
  /** true = handmatige wissel door een admin (i.p.v. een ruil tussen collega's). */
  swapManual?: boolean;
  /** Naam van de chauffeur die de dienst afstond. */
  swapFrom?: string;
};

export type MonthPlanning = {
  month: string;
  /** datums (yyyy-mm-dd) die een planning-rij hebben deze maand, oplopend */
  dates: string[];
  /** actieve chauffeurs, gesorteerd op sectie → naam; section null = geen sectie */
  drivers: { id: string; name: string; section?: string | null }[];
  /** cells[driverId][date] = { code, kind } — alleen niet-lege cellen */
  cells: Record<string, Record<string, MonthCell>>;
};

export function fetchMonthPlanning(month: string): Promise<MonthPlanning> {
  return apiJson<MonthPlanning>(`/api/month-planning?month=${month}`);
}
