import { apiFetch } from './api';
import type { DayGap } from './coverageGaps';

export type { DayGap } from './coverageGaps';

export type CoverageConfig = {
  /** ingestelde verwachte dienstnummers per dag-type */
  expectations: Record<string, string[]>;
  /** dag-types die in de planning-matrix voorkomen */
  dayTypes: string[];
  /** alle dienstnummers uit het dienstoverzicht (om uit te kiezen) */
  services: string[];
};

export type CoverageGaps = {
  from: string;
  to: string;
  days: DayGap[];
};

export function fetchCoverageConfig(): Promise<CoverageConfig> {
  return apiFetch<CoverageConfig>('/api/coverage-expectations');
}

export function saveCoverageExpectations(expectations: Record<string, string[]>): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>('/api/coverage-expectations', {
    method: 'PUT',
    body: JSON.stringify({ expectations }),
  });
}

export function fetchCoverageGaps(from: string, to: string): Promise<CoverageGaps> {
  return apiFetch<CoverageGaps>(`/api/coverage-gaps?from=${from}&to=${to}`);
}
