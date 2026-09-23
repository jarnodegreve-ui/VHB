import type { Diversion, LeaveRequest, Shift, SwapRequest, User } from '../types';
import type { DayGap } from './coverage';
import { openstaandeDienstenVanAfwezigen, type OpenstaandeDienst } from './availability';
import { lopendeDiversions } from './diversions';

/**
 * Dagbriefing van de planner (verbeterronde 4, punt 4): alles wat op één dag
 * speelt, op één scherm (/vandaag). Het Overzicht (werkvoorraad) zegt wat er
 * over alle dagen heen op een beslissing wacht; dit is de doorsnede van één
 * dag, ook met wat al geregeld is (een goedgekeurde ruil: wie rijdt er vandaag
 * in de plaats van wie). Puur en zonder fetches; de view tekent alleen.
 */
export type BriefingAfwezige = {
  userId: string;
  naam: string;
  phone?: string;
  type: LeaveRequest['type'];
  /** De aanvraag achter de afwezigheid (voor `/verlof/<id>`, tranche 3C). */
  leaveId: string;
  /** Laatste dag van de afwezigheid (ISO). */
  tot: string;
  /** Diensten van de dag die nog op zijn naam staan: te herverdelen. */
  diensten: OpenstaandeDienst[];
};

export type BriefingRuil = {
  swap: SwapRequest;
  /** Welke kant van de ruil op deze dag valt. */
  kant: 'dienst' | 'tegenprestatie';
  dienst: string;
  /** Wie de dienst afgeeft en wie hem op deze dag rijdt als de ruil doorgaat. */
  vanId: string;
  naarId: string | null;
  /** Wacht nog op de planner (of op de collega). */
  open: boolean;
};

export type DagBriefing = {
  dag: string;
  afwezigen: BriefingAfwezige[];
  /** Dienstnummers zonder chauffeur; null = dekking nog niet geladen (onbekend, niet "alles gedekt"). */
  openDiensten: string[] | null;
  ruilen: BriefingRuil[];
  omleidingen: Diversion[];
  /** Aantal punten dat vandaag nog een beslissing vraagt. */
  aandacht: number;
};

/** Ziekte eerst: een ziekmelding mag nooit onder een verlof wegvallen. */
const TYPE_RANG: Record<LeaveRequest['type'], number> = { ziekte: 0, klein_verlet: 1, betaald_verlof: 2 };
const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/;
const RUIL_IN_BEELD = new Set<SwapRequest['status']>(['pending', 'accepted', 'approved', 'completed']);
const normCode = (c: unknown) => String(c ?? '').trim().toLowerCase();

export function bouwDagBriefing({ dag, users, shifts, leaveRequests, swaps, diversions, coverageDays }: {
  dag: string;
  users: readonly User[];
  shifts: Shift[];
  leaveRequests: LeaveRequest[];
  swaps: readonly SwapRequest[];
  diversions: Diversion[];
  coverageDays: DayGap[] | null;
}): DagBriefing {
  const gebruiker = (id: string) => users.find((u) => String(u.id) === String(id));

  // --- Afwezigen: één regel per persoon, ziekte wint bij overlap ---
  const teHerverdelen = openstaandeDienstenVanAfwezigen(shifts, leaveRequests, dag, { totIso: dag });
  const perPersoon = new Map<string, LeaveRequest>();
  for (const l of leaveRequests) {
    if (l.status !== 'approved') continue;
    if (!ISO_DAG.test(l.startDate) || !ISO_DAG.test(l.endDate) || l.startDate > dag || l.endDate < dag) continue;
    const id = String(l.userId);
    const bestaand = perPersoon.get(id);
    if (!bestaand || TYPE_RANG[l.type] < TYPE_RANG[bestaand.type]) perPersoon.set(id, l);
  }
  const afwezigen: BriefingAfwezige[] = [...perPersoon.entries()]
    .map(([id, l]) => {
      const u = gebruiker(id);
      return {
        userId: id,
        naam: u?.name ?? `Onbekend (${id})`,
        phone: u?.phone,
        type: l.type,
        leaveId: String(l.id),
        tot: l.endDate,
        diensten: teHerverdelen.filter((s) => String(s.driverId) === id),
      };
    })
    // Wie nog een dienst op zijn naam heeft staat bovenaan, dan ziekte, dan op naam.
    .sort((a, b) =>
      Number(b.diensten.length > 0) - Number(a.diensten.length > 0)
      || TYPE_RANG[a.type] - TYPE_RANG[b.type]
      || a.naam.localeCompare(b.naam, 'nl'));

  // --- Open diensten: zonder wat al onder "te herverdelen" staat (zelfde
  // regel als de werkvoorraad, anders weegt één zieke met één dienst dubbel) ---
  const herverdeelCodes = new Set(teHerverdelen.map((s) => normCode(s.line)));
  const dekking = coverageDays?.find((d) => d.date === dag);
  const openDiensten = coverageDays === null
    ? null
    : (dekking?.missing ?? []).filter((code) => !herverdeelCodes.has(normCode(code)));

  // --- Ruilen die deze dag raken, langs de dienst of langs de tegenprestatie ---
  const ruilen: BriefingRuil[] = [];
  for (const swap of swaps) {
    if (!RUIL_IN_BEELD.has(swap.status)) continue;
    const open = swap.status === 'pending' || swap.status === 'accepted';
    if (swap.shiftDate === dag) {
      ruilen.push({ swap, kant: 'dienst', dienst: swap.shiftLine ?? '', vanId: String(swap.requesterId), naarId: swap.targetDriverId ? String(swap.targetDriverId) : null, open });
    }
    const terug = normCode(swap.returnCode);
    if (swap.returnDate === dag && terug && terug !== 'vrij' && swap.targetDriverId) {
      ruilen.push({ swap, kant: 'tegenprestatie', dienst: String(swap.returnCode), vanId: String(swap.targetDriverId), naarId: String(swap.requesterId), open });
    }
  }
  ruilen.sort((a, b) => Number(b.open) - Number(a.open) || a.dienst.localeCompare(b.dienst, 'nl'));

  const omleidingen = lopendeDiversions(diversions, dag);

  const aandacht =
    afwezigen.reduce((n, a) => n + a.diensten.length, 0)
    + (openDiensten?.length ?? 0)
    + ruilen.filter((r) => r.open).length;

  return { dag, afwezigen, openDiensten, ruilen, omleidingen, aandacht };
}

/** "3 punten vragen nog een beslissing" / "Alles geregeld". */
export function briefingKop(b: DagBriefing, dagWoord: 'vandaag' | 'morgen'): string {
  if (b.aandacht === 0) return b.openDiensten === null ? `Dekking voor ${dagWoord} nog niet geladen` : `Alles geregeld voor ${dagWoord}`;
  return `${b.aandacht} ${b.aandacht === 1 ? 'punt vraagt' : 'punten vragen'} nog een beslissing`;
}
