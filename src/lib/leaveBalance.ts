import type { LeaveRequest } from '../types';
import { feestdagNaam } from './typedag';

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

/**
 * Extra vrije dagen (beheerder, app_settings 'verlof_feestdagen'): de
 * datalaag zet ze hier zodra ze geladen zijn, zodat élke telling in de app
 * ze meeneemt zonder dat elke view ze hoeft door te geven. Views die het
 * expliciet willen, geven de set als derde argument mee.
 */
let extraFeestdagenStandaard: ReadonlySet<string> = new Set();
export const stelExtraFeestdagenIn = (dagen: Iterable<string>) => { extraFeestdagenStandaard = new Set(dagen); };

/** Telt deze dag als verlofdag? Zondag nooit, een wettelijke feestdag nooit,
 *  een extra vrije dag van de beheerder nooit. */
export const isVerlofdag = (iso: string, extraFeestdagen: ReadonlySet<string> = extraFeestdagenStandaard): boolean => {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return false;
  if (new Date(Date.UTC(y, m - 1, d)).getUTCDay() === 0) return false;
  if (feestdagNaam(iso)) return false;
  return !extraFeestdagen.has(iso);
};

/**
 * Verlofdagen in een periode: maandag tot en met zaterdag tellen mee, zondag
 * nooit (regel Jarno 09-09), en een feestdag ook niet (Jarno 10-09): wie
 * verlof neemt over Kerstmis, betaalt die dag niet uit zijn saldo.
 *
 * Bewust naast `daysBetween` en niet in de plaats ervan: ziekte en de
 * aftelteksten ("nog 3 dagen", "terug op…") rekenen wél in kalenderdagen —
 * een ziekte loopt gewoon door op zondag.
 */
export const verlofDagen = (startIso: string, endIso: string, extraFeestdagen: ReadonlySet<string> = extraFeestdagenStandaard): number => {
  const totaal = daysBetween(startIso, endIso);
  if (totaal === 0) return 0;
  const [sy, sm, sd] = startIso.split('-').map(Number);
  let telling = 0;
  // Dag voor dag (UTC, DST-veilig); een verlofperiode is hooguit maanden lang.
  for (let i = 0; i < totaal; i++) {
    const d = new Date(Date.UTC(sy, sm - 1, sd + i));
    const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    if (isVerlofdag(iso, extraFeestdagen)) telling += 1;
  }
  return telling;
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

export function verlofBalans(leaves: LeaveRequest[], userId: string, year: number, customBudget?: number, extraFeestdagen: ReadonlySet<string> = extraFeestdagenStandaard): LeaveBalance {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const budget = typeof customBudget === 'number' && customBudget >= 0 ? customBudget : BETAALD_VERLOF_BUDGET;

  const inJaar = leaves.filter((l) => l.userId === userId && l.startDate <= yearEnd && l.endDate >= yearStart);
  const relevant = inJaar.filter((l) => l.status === 'approved');
  const dagenIn = (l: LeaveRequest) => verlofDagen(clipToYear(l.startDate, year, 'start'), clipToYear(l.endDate, year, 'end'), extraFeestdagen);
  const betaaldAangevraagd = inJaar
    .filter((l) => l.status === 'pending' && l.type === 'betaald_verlof')
    .reduce((sum, l) => sum + dagenIn(l), 0);

  const betaaldGebruikt = relevant
    .filter((l) => l.type === 'betaald_verlof')
    .reduce((sum, l) => sum + dagenIn(l), 0);

  const kleinVerletDagen = relevant
    .filter((l) => l.type === 'klein_verlet')
    .reduce((sum, l) => sum + dagenIn(l), 0);

  return {
    betaaldGebruikt,
    betaaldAangevraagd,
    betaaldResterend: Math.max(0, budget - betaaldGebruikt),
    betaaldVrij: Math.max(0, budget - betaaldGebruikt - betaaldAangevraagd),
    betaaldBudget: budget,
    kleinVerletDagen,
  };
}
