import { apiJson } from './api';
import type { DayGap } from './coverageGaps';

export type { DayGap } from './coverageGaps';

/** Eén zelf-gedefinieerd dag-type met de verwachte diensten (welke + hoeveel). */
export type CoverageDayType = { name: string; services: string[] };
/** Uitzondering: binnen [from,to] geldt een ander dag-type dan de weekdag-standaard. */
export type CoverageOverride = { from: string; to: string; dayType: string };
/** Weekdag-toewijzing met ingangsdatum: vanaf `vanaf` geldt deze i.p.v. de basis
 *  (bv. het schooljaar-regime vanaf 1 september). Recentste ingangsdatum wint. */
export type CoverageWeekdayPeriod = { vanaf: string; weekdays: string[] };

export type CoverageConfig = {
  /** alle dienstnummers uit het dienstoverzicht (om uit te kiezen) */
  services: string[];
  /** zelf-beheerde dag-types + hun verwachte diensten */
  dayTypes: CoverageDayType[];
  /** standaard dag-type per weekdag — index 0=zondag .. 6=zaterdag */
  weekdays: string[];
  /** weekdag-toewijzingen die vanaf een datum de basis vervangen */
  weekdayPeriods: CoverageWeekdayPeriod[];
  /** uitzonderingen die de weekdag-standaard overschrijven */
  overrides: CoverageOverride[];
};

export type CoverageConfigInput = {
  dayTypes: CoverageDayType[];
  weekdays: string[];
  weekdayPeriods: CoverageWeekdayPeriod[];
  overrides: CoverageOverride[];
};

export type CoverageGaps = {
  from: string;
  to: string;
  days: DayGap[];
};

export function fetchCoverageConfig(): Promise<CoverageConfig> {
  return apiJson<CoverageConfig>('/api/coverage-expectations');
}

export function saveCoverageConfig(config: CoverageConfigInput): Promise<{ success: boolean }> {
  return apiJson<{ success: boolean }>('/api/coverage-expectations', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export function fetchCoverageGaps(from: string, to: string): Promise<CoverageGaps> {
  return apiJson<CoverageGaps>(`/api/coverage-gaps?from=${from}&to=${to}`);
}

export type ExpectationCheck = {
  from: string;
  to: string;
  dagen: number;
  afwijkingen: import('./coverageGaps').VerwachtingAfwijking[];
};

export type ExpectationVoorstel = {
  from: string;
  to: string;
  dagen: number;
  voorstellen: import('./coverageGaps').VerwachtingVoorstel[];
};

/** Lijstenvoorstel uit de praktijk: per dag-type de codes die op minstens de
 *  helft van de dagen echt gereden worden. */
export function fetchExpectationVoorstel(from: string, to: string): Promise<ExpectationVoorstel> {
  return apiJson<ExpectationVoorstel>(`/api/coverage-expectations/voorstel?from=${from}&to=${to}`);
}

/** Verwachtingen-vs-praktijk: verwachte diensten die in de periode nooit
 *  gereden worden + structureel gereden codes buiten de verwachting. */
export function fetchExpectationCheck(from: string, to: string): Promise<ExpectationCheck> {
  return apiJson<ExpectationCheck>(`/api/coverage-expectation-check?from=${from}&to=${to}`);
}
