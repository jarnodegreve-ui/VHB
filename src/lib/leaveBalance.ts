import type { LeaveRequest } from '../types';

// Standaard betaald verlof bij VHB: 24 dagen (boven het wettelijk minimum
// van 20). Kan later per gebruiker configureerbaar worden door een veld
// 'verlofBudget' aan de User-type toe te voegen (anciënniteits-toeslag,
// deeltijdse contracten, etc.).
export const BETAALD_VERLOF_BUDGET = 24;

export const daysBetween = (startIso: string, endIso: string): number => {
  if (!startIso || !endIso) return 0;
  // UTC-rekenen i.p.v. lokale tijd: een lokale dag is bij de overgang naar
  // zomertijd (laatste zondag maart) maar 23u, waardoor floor() een hele
  // verlofdag te weinig telde voor periodes die die dag bevatten. UTC-dagen
  // zijn altijd 24u, dus geen DST-drift.
  const [sy, sm, sd] = startIso.split('-').map(Number);
  const [ey, em, ed] = endIso.split('-').map(Number);
  if (!sy || !sm || !sd || !ey || !em || !ed) return 0;
  const ms = Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd);
  if (Number.isNaN(ms) || ms < 0) return 0;
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1;
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
  /** Nog niet beoordeelde aanvragen (betaald verlof) in dit jaar — zit niet
   *  in `betaaldGebruikt`, maar een chauffeur wil wel weten wat er nog
   *  "onderweg" is voor hij een volgende aanvraag doet. */
  betaaldAangevraagd: number;
  /** Budget min opgenomen (goedgekeurd). */
  betaaldResterend: number;
  /** Budget min opgenomen én aangevraagd: wat je nog vrij kunt aanvragen. */
  betaaldVrij: number;
  betaaldBudget: number;
  kleinVerletDagen: number;
}

export function verlofBalans(leaves: LeaveRequest[], userId: string, year: number, customBudget?: number): LeaveBalance {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const budget = typeof customBudget === 'number' && customBudget >= 0 ? customBudget : BETAALD_VERLOF_BUDGET;

  const inJaar = leaves.filter((l) => l.userId === userId && l.startDate <= yearEnd && l.endDate >= yearStart);
  const relevant = inJaar.filter((l) => l.status === 'approved');
  const dagenIn = (l: LeaveRequest) => daysBetween(clipToYear(l.startDate, year, 'start'), clipToYear(l.endDate, year, 'end'));
  const betaaldAangevraagd = inJaar
    .filter((l) => l.status === 'pending' && l.type === 'betaald_verlof')
    .reduce((sum, l) => sum + dagenIn(l), 0);

  const betaaldGebruikt = relevant
    .filter((l) => l.type === 'betaald_verlof')
    .reduce((sum, l) => sum + daysBetween(clipToYear(l.startDate, year, 'start'), clipToYear(l.endDate, year, 'end')), 0);

  const kleinVerletDagen = relevant
    .filter((l) => l.type === 'klein_verlet')
    .reduce((sum, l) => sum + daysBetween(clipToYear(l.startDate, year, 'start'), clipToYear(l.endDate, year, 'end')), 0);

  return {
    betaaldGebruikt,
    betaaldAangevraagd,
    betaaldResterend: Math.max(0, budget - betaaldGebruikt),
    betaaldVrij: Math.max(0, budget - betaaldGebruikt - betaaldAangevraagd),
    betaaldBudget: budget,
    kleinVerletDagen,
  };
}
