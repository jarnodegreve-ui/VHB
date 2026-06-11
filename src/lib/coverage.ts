import { apiFetch } from './api';
import type { DayGap } from './coverageGaps';

export type { DayGap } from './coverageGaps';

/** Eén zelf-gedefinieerd dag-type met de verwachte diensten (welke + hoeveel). */
export type CoverageDayType = { name: string; services: string[] };
/** Uitzondering: binnen [from,to] geldt een ander dag-type dan de weekdag-standaard. */
export type CoverageOverride = { from: string; to: string; dayType: string };

export type CoverageConfig = {
  /** alle dienstnummers uit het dienstoverzicht (om uit te kiezen) */
  services: string[];
  /** zelf-beheerde dag-types + hun verwachte diensten */
  dayTypes: CoverageDayType[];
  /** standaard dag-type per weekdag — index 0=zondag .. 6=zaterdag */
  weekdays: string[];
  /** uitzonderingen die de weekdag-standaard overschrijven */
  overrides: CoverageOverride[];
};

export type CoverageConfigInput = {
  dayTypes: CoverageDayType[];
  weekdays: string[];
  overrides: CoverageOverride[];
};

export type CoverageGaps = {
  from: string;
  to: string;
  days: DayGap[];
};

export function fetchCoverageConfig(): Promise<CoverageConfig> {
  return apiFetch<CoverageConfig>('/api/coverage-expectations');
}

export function saveCoverageConfig(config: CoverageConfigInput): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/api/coverage-expectations', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export function fetchCoverageGaps(from: string, to: string): Promise<CoverageGaps> {
  return apiFetch<CoverageGaps>(`/api/coverage-gaps?from=${from}&to=${to}`);
}
