import type { LeaveRequest } from '../types';

// Standaard wettelijk verlof in België: 4 weken = 20 dagen.
// Kan later per gebruiker configureerbaar worden door een veld
// 'verlofBudget' aan de User-type toe te voegen.
export const BETAALD_VERLOF_BUDGET = 20;

const daysBetween = (startIso: string, endIso: string): number => {
  if (!startIso || !endIso) return 0;
  const start = new Date(`${startIso}T00:00:00`);
  const end = new Date(`${endIso}T00:00:00`);
  const ms = end.getTime() - start.getTime();
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.floor(ms / (1000 * 60 * 60 * 24)) + 1;
};

const clipToYear = (iso: string, year: number, fallback: 'start' | 'end') => {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (!iso) return fallback === 'start' ? yearStart : yearEnd;
  if (iso < yearStart) return yearStart;
  if (iso > yearEnd) return yearEnd;
  return iso;
};

export interface LeaveBalance {
  betaaldGebruikt: number;
  betaaldResterend: number;
  betaaldBudget: number;
  kleinVerletDagen: number;
}

export function verlofBalans(leaves: LeaveRequest[], userId: string, year: number): LeaveBalance {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const relevant = leaves.filter((l) =>
    l.userId === userId &&
    l.status === 'approved' &&
    l.startDate <= yearEnd &&
    l.endDate >= yearStart,
  );

  const betaaldGebruikt = relevant
    .filter((l) => l.type === 'betaald_verlof')
    .reduce((sum, l) => sum + daysBetween(clipToYear(l.startDate, year, 'start'), clipToYear(l.endDate, year, 'end')), 0);

  const kleinVerletDagen = relevant
    .filter((l) => l.type === 'klein_verlet')
    .reduce((sum, l) => sum + daysBetween(clipToYear(l.startDate, year, 'start'), clipToYear(l.endDate, year, 'end')), 0);

  return {
    betaaldGebruikt,
    betaaldResterend: Math.max(0, BETAALD_VERLOF_BUDGET - betaaldGebruikt),
    betaaldBudget: BETAALD_VERLOF_BUDGET,
    kleinVerletDagen,
  };
}
