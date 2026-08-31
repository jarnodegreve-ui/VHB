import type { LeaveRequest, PlanningMatrixImportHistory, Shift, SwapRequest, User } from '../types';
import type { DayGap } from './coverage';
import { isoDate, openstaandeDienstenVanAfwezigen, type OpenstaandeDienst } from './availability';

/**
 * Werkvoorraad van de planner — de éne bron van waarheid voor alles wat
 * "open" staat: gebruikt door de topbar-knop (badge + uitklapmenu) én het
 * "Open taken"-paneel op het planner-dashboard. Puur en zonder fetches: de
 * aanroeper levert de data (vervaldata en wachtende toestellen komen uit
 * losse endpoints, de rest uit de gewone app-state).
 */

export type VervaldataRij = { userId: string; soort: string; validUntil: string };
export type PendingDevice = { userId: string; name: string; createdAt: string };

export type Werkvoorraad = {
  /** Er wérd geïmporteerd, maar al > 7 dagen niet meer. */
  planningStale: boolean;
  daysSinceImport: number | null;
  lastImport: PlanningMatrixImportHistory | null;
  importIssueCount: number;
  /** Laatste geplande dag; krap = eindigt binnen 5 dagen (of is al op). */
  planningHorizon: string;
  horizonDagenOver: number | null;
  horizonKrap: boolean;
  /** Dagen met een dekkingsgat (coverageDays null = onbekend = geen rijen). */
  gapDays: DayGap[];
  /** Vervaldata (Code 95/schifting) van actieve chauffeurs, ≤ 30 dagen. */
  vervalTaken: Array<VervaldataRij & { dagen: number }>;
  /** Diensten die nog op naam staan van iemand die afwezig gemeld is. */
  teHerverdelen: OpenstaandeDienst[];
  herverdeelPerChauffeur: Array<{ driverId: string; naam: string; reden: string; diensten: OpenstaandeDienst[] }>;
  pendingLeave: LeaveRequest[];
  pendingSwaps: SwapRequest[];
  pendingDevices: PendingDevice[];
  openTasks: number;
  attentionCount: number;
  needsAttention: boolean;
};

const STALE_PLANNING_DAYS = 7;
const HORIZON_WAARSCHUWING_DAGEN = 5;
const VERVAL_VENSTER_DAGEN = 30;

export function berekenWerkvoorraad({
  users,
  shifts,
  leaveRequests,
  swaps,
  matrixHistory,
  coverageDays,
  vervaldata,
  pendingDevices,
  now,
}: {
  users: User[];
  shifts: Shift[];
  leaveRequests: LeaveRequest[];
  swaps: SwapRequest[];
  matrixHistory: PlanningMatrixImportHistory[];
  coverageDays: DayGap[] | null;
  vervaldata: VervaldataRij[];
  pendingDevices: PendingDevice[];
  now: Date;
}): Werkvoorraad {
  const today = isoDate(now);

  // Documenten die binnen 30 dagen verlopen (of al verlopen zijn) — alleen
  // van actieve chauffeurs; gesorteerd op urgentie.
  const isActiveUserId = (id: string) => users.some((u) => String(u.id) === id && u.isActive !== false);
  const vervalTaken = vervaldata
    .filter((e) => isActiveUserId(e.userId))
    .map((e) => ({ ...e, dagen: Math.round((Date.parse(e.validUntil) - Date.parse(today)) / 86400000) }))
    .filter((e) => Number.isFinite(e.dagen) && e.dagen <= VERVAL_VENSTER_DAGEN)
    .sort((a, b) => a.dagen - b.dagen);

  // Alleen vandaag en verder: gisteren valt niets meer te herverdelen.
  const teHerverdelen = openstaandeDienstenVanAfwezigen(shifts, leaveRequests, today);
  // Per chauffeur gegroepeerd: bij een langere ziekte zijn het er al gauw
  // acht — het totaal hoort meteen in de rij (melding Jarno 14-08).
  const naamVan = (id: string) => users.find((u) => String(u.id) === String(id))?.name || 'Onbekend';
  const herverdeelPerChauffeur = Array.from(
    teHerverdelen.reduce((map, s) => {
      const key = String(s.driverId);
      const groep = map.get(key) ?? { driverId: key, naam: naamVan(key), reden: s.reden, diensten: [] as OpenstaandeDienst[] };
      groep.diensten.push(s);
      map.set(key, groep);
      return map;
    }, new Map<string, { driverId: string; naam: string; reden: string; diensten: OpenstaandeDienst[] }>()).values(),
  );

  // Dekking: null = niet geladen/fout — behandel als 'onbekend', nooit als
  // 'volledig gedekt'.
  const gapDays = (coverageDays ?? []).filter((d) => d.missing.length > 0);

  const pendingLeave = leaveRequests.filter((r) => r.status === 'pending');
  const pendingSwaps = swaps.filter((s) => s.status === 'pending' || s.status === 'accepted');
  const openTasks = pendingLeave.length + pendingSwaps.length + pendingDevices.length;

  const lastImport = matrixHistory[0] || null;
  const importIssueCount = lastImport
    ? lastImport.unknownCodes.length + lastImport.unmatchedDrivers.length
    : 0;
  const daysSinceImport = lastImport
    ? Math.floor((now.getTime() - new Date(lastImport.createdAt).getTime()) / 86400000)
    : null;
  // Nooit geïmporteerd = niet naggen — kan een niet-import-opzet zijn.
  const planningStale = daysSinceImport !== null && daysSinceImport > STALE_PLANNING_DAYS;

  const planningHorizon = shifts.reduce((max, s) => (s.date > max ? s.date : max), '');
  const horizonDagenOver = planningHorizon
    ? Math.round((Date.parse(planningHorizon) - Date.parse(today)) / 86400000)
    : null;
  const horizonKrap = horizonDagenOver !== null && horizonDagenOver <= HORIZON_WAARSCHUWING_DAGEN;

  const attentionCount =
    (planningStale ? 1 : 0) + (importIssueCount > 0 ? 1 : 0) + (horizonKrap ? 1 : 0) +
    gapDays.length + openTasks + vervalTaken.length + teHerverdelen.length;

  return {
    planningStale,
    daysSinceImport,
    lastImport,
    importIssueCount,
    planningHorizon,
    horizonDagenOver,
    horizonKrap,
    gapDays,
    vervalTaken,
    teHerverdelen,
    herverdeelPerChauffeur,
    pendingLeave,
    pendingSwaps,
    pendingDevices,
    openTasks,
    attentionCount,
    needsAttention: attentionCount > 0,
  };
}
