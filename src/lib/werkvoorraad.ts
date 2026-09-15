import type { LeaveRequest, PlanningMatrixImportHistory, Shift, SwapRequest, User, View } from '../types';
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

// ---------------------------------------------------------------------------
// Platte itemlijst (scherm /werkvoorraad, 15-09)
// ---------------------------------------------------------------------------

/** Soorten werk, in de volgorde van de tegels en filterchips op /werkvoorraad. */
export type WerkSoort = 'verlof' | 'ruil' | 'herverdelen' | 'dekking' | 'toestellen' | 'vervaldata' | 'planning';

export const WERK_SOORTEN: readonly WerkSoort[] = ['verlof', 'ruil', 'herverdelen', 'dekking', 'toestellen', 'vervaldata', 'planning'];

export const WERK_SOORT_LABELS: Record<WerkSoort, string> = {
  verlof: 'Verlof',
  ruil: 'Dienstruil',
  herverdelen: 'Te herverdelen',
  dekking: 'Open diensten',
  toestellen: 'Toestellen',
  vervaldata: 'Vervaldata',
  planning: 'Planning',
};

export type WerkItem = {
  /** Stabiele sleutel (React key + selectie). */
  key: string;
  soort: WerkSoort;
  tone: 'red' | 'amber' | 'blue';
  titel: string;
  detail?: string;
  /** Hoeveel eenheden dit item in de teller weegt (een herverdeel-rij telt
   *  per dienst; alles anders 1). De som over alle items = attentionCount. */
  aantal: number;
  /** Sorteeras "wat dringt het meest": epoch ms van het moment dat telt.
   *  Voor aanvragen en toestellen de aanmaakdatum (oudste eerst), voor
   *  vervaldata en open diensten de datum zelf (dichtstbij eerst). */
  wanneer: number;
  /** Leesbare vorm van `wanneer` ("3 dagen geleden", "over 12 dagen", "ma 21 sep"). */
  wanneerTekst: string;
  /** Naam van de betrokken collega (zoekveld). */
  naam?: string;
  /** Waar de beslissing genomen wordt (zelfde doelen als het dashboardpaneel). */
  doel: View;
  doelParams?: string[];
  /** Alleen voor toestellen: de rij uit pendingDevices, voor goedkeuren. */
  toestel?: PendingDevice;
};

/** "zojuist" / "12 min geleden" / "3 u geleden" / "gisteren" / "5 dagen geleden". */
export function sindsTekst(iso: string, now: Date): string {
  const diff = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(diff) || diff < 0) return '';
  const minuten = Math.floor(diff / 60000);
  if (minuten < 1) return 'zojuist';
  if (minuten < 60) return `${minuten} min geleden`;
  const uren = Math.floor(minuten / 60);
  if (uren < 24) return `${uren} u geleden`;
  const dagen = Math.floor(uren / 24);
  return dagen === 1 ? 'gisteren' : `${dagen} dagen geleden`;
}

const overTekst = (dagen: number): string =>
  dagen < 0
    ? `${Math.abs(dagen)} ${Math.abs(dagen) === 1 ? 'dag' : 'dagen'} verlopen`
    : dagen === 0 ? 'vandaag' : `over ${dagen} ${dagen === 1 ? 'dag' : 'dagen'}`;

const epochVanDag = (iso: string): number => {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
};
const epochVanTijd = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
};

/**
 * De werkvoorraad als platte lijst, één item per beslissing, gesorteerd op
 * wat het meest dringt (oudste aanvraag / dichtstbijzijnde datum eerst).
 * Herverdelen is één item per chauffeur (met `aantal` = diensten), zoals het
 * dashboardpaneel; de som van `aantal` is exact `attentionCount`, zodat de
 * tegels op /werkvoorraad en de badge in de topbar nooit uiteenlopen.
 * `formatDag` levert de korte dagnaam (lib/format.formatShortDay) zodat deze
 * module zelf niets uit de UI-laag hoeft te trekken.
 */
export function werkvoorraadItems(
  wv: Werkvoorraad,
  opts: { naamVan: (id: string) => string; now: Date; formatDag: (iso: string) => string; soortLabel?: (soort: string) => string },
): WerkItem[] {
  const { naamVan, now, formatDag } = opts;
  const soortLabel = opts.soortLabel ?? ((s) => s);
  const today = isoDate(now);
  const items: WerkItem[] = [];
  const enkelvoud = (n: number, ev: string, mv: string) => `${n} ${n === 1 ? ev : mv}`;
  const importMoment = wv.lastImport ? epochVanTijd(wv.lastImport.createdAt) : now.getTime();

  if (wv.planningStale) {
    items.push({
      key: 'planning:stale', soort: 'planning', tone: 'amber', aantal: 1,
      titel: `Planning al ${wv.daysSinceImport} dagen niet bijgewerkt`,
      detail: 'Upload de laatste Excel zodat de planning actueel blijft.',
      wanneer: importMoment, wanneerTekst: wv.lastImport ? sindsTekst(wv.lastImport.createdAt, now) : '',
      doel: 'beheer-roosters',
    });
  }
  if (wv.horizonKrap) {
    const op = (wv.horizonDagenOver ?? 0) <= 0;
    items.push({
      key: 'planning:horizon', soort: 'planning', tone: op ? 'red' : 'amber', aantal: 1,
      titel: op ? 'De geladen planning is op' : `Planning geladen t/m ${formatDag(wv.planningHorizon)}`,
      detail: 'Importeer de volgende periode zodat chauffeurs vooruit kunnen kijken.',
      wanneer: wv.planningHorizon ? epochVanDag(wv.planningHorizon) : now.getTime(),
      wanneerTekst: op ? 'nu' : `nog ${enkelvoud(wv.horizonDagenOver ?? 0, 'dag', 'dagen')}`,
      doel: 'beheer-roosters',
    });
  }
  if (wv.importIssueCount > 0 && wv.lastImport) {
    items.push({
      key: 'planning:import', soort: 'planning', tone: 'red', aantal: 1,
      titel: 'Laatste import heeft aandachtspunten',
      detail: [
        wv.lastImport.unknownCodes.length > 0 ? `${wv.lastImport.unknownCodes.length} onbekende codes` : null,
        wv.lastImport.unmatchedDrivers.length > 0 ? `${wv.lastImport.unmatchedDrivers.length} niet-gematchte chauffeurs` : null,
      ].filter(Boolean).join(' · '),
      wanneer: importMoment, wanneerTekst: sindsTekst(wv.lastImport.createdAt, now),
      doel: 'beheer-roosters',
    });
  }
  for (const g of wv.herverdeelPerChauffeur) {
    const eerste = g.diensten.reduce((min, s) => (s.date < min ? s.date : min), g.diensten[0]?.date ?? today);
    items.push({
      key: `herverdeel:${g.driverId}`, soort: 'herverdelen', tone: 'red', aantal: g.diensten.length,
      titel: `${enkelvoud(g.diensten.length, 'dienst', 'diensten')} nog niet herverdeeld, ${g.naam}`,
      detail: `${g.reden} · ${g.diensten.slice(0, 4).map((s) => `${formatDag(s.date)} (${s.line})`).join(', ')}${g.diensten.length > 4 ? `, +${g.diensten.length - 4}` : ''}`,
      wanneer: epochVanDag(eerste), wanneerTekst: eerste === today ? 'vandaag' : formatDag(eerste),
      naam: g.naam,
      doel: 'ziekte',
    });
  }
  for (const d of wv.gapDays) {
    items.push({
      key: `dekking:${d.date}`, soort: 'dekking', tone: 'red', aantal: 1,
      titel: `${d.missing.length} open ${d.missing.length === 1 ? 'dienst' : 'diensten'}, ${formatDag(d.date)}`,
      detail: `Dienst ${d.missing.slice(0, 6).join(', ')}${d.missing.length > 6 ? '…' : ''}`,
      wanneer: epochVanDag(d.date), wanneerTekst: d.date === today ? 'vandaag' : formatDag(d.date),
      doel: 'dekking', doelParams: [d.date.slice(0, 7)],
    });
  }
  for (const req of wv.pendingLeave) {
    const naam = naamVan(req.userId);
    items.push({
      key: `verlof:${req.id}`, soort: 'verlof', tone: 'amber', aantal: 1,
      titel: `Verlofaanvraag · ${naam}`,
      detail: `${formatDag(req.startDate)}${req.startDate !== req.endDate ? ` → ${formatDag(req.endDate)}` : ''} · ${req.type === 'betaald_verlof' ? 'betaald verlof' : req.type === 'klein_verlet' ? 'klein verlet' : 'ziekte'}`,
      wanneer: epochVanTijd(req.createdAt), wanneerTekst: sindsTekst(req.createdAt, now),
      naam,
      doel: 'verlof',
    });
  }
  for (const swap of wv.pendingSwaps) {
    const aanvrager = naamVan(swap.requesterId);
    const collega = swap.targetDriverId ? naamVan(swap.targetDriverId) : null;
    items.push({
      key: `ruil:${swap.id}`, soort: 'ruil', tone: 'blue', aantal: 1,
      titel: `${swap.swapType === 'overname' ? 'Overname' : 'Dienstruil'} · ${collega ? `${aanvrager} → ${collega}` : aanvrager}`,
      detail: swap.status === 'accepted' ? 'Collega akkoord, wacht op validatie' : swap.reason || 'Wacht op een collega',
      wanneer: epochVanTijd(swap.createdAt), wanneerTekst: sindsTekst(swap.createdAt, now),
      naam: [aanvrager, collega].filter(Boolean).join(' '),
      doel: 'ruil-verzoeken',
    });
  }
  for (const dev of wv.pendingDevices) {
    const naam = naamVan(dev.userId);
    items.push({
      key: `toestel:${dev.userId}:${dev.name}:${dev.createdAt}`, soort: 'toestellen', tone: 'amber', aantal: 1,
      titel: `Toestel wacht op goedkeuring · ${naam}`,
      detail: dev.name,
      wanneer: epochVanTijd(dev.createdAt), wanneerTekst: sindsTekst(dev.createdAt, now),
      naam,
      doel: 'toestellen',
      toestel: dev,
    });
  }
  for (const e of wv.vervalTaken) {
    const naam = naamVan(e.userId);
    items.push({
      key: `verval:${e.userId}:${e.soort}`, soort: 'vervaldata', tone: e.dagen < 0 ? 'red' : 'amber', aantal: 1,
      titel: `${soortLabel(e.soort)} · ${naam}`,
      detail: e.dagen < 0 ? `Verlopen sinds ${formatDag(e.validUntil)}` : `Verloopt ${formatDag(e.validUntil)}`,
      wanneer: epochVanDag(e.validUntil), wanneerTekst: overTekst(e.dagen),
      naam,
      doel: 'vervaldata',
    });
  }

  return items.sort((a, b) => a.wanneer - b.wanneer || a.titel.localeCompare(b.titel, 'nl'));
}

/** Telling per soort (som van `aantal`), voor tegels en chips. */
export function telPerSoort(items: readonly WerkItem[]): Record<WerkSoort, number> {
  const uit = Object.fromEntries(WERK_SOORTEN.map((s) => [s, 0])) as Record<WerkSoort, number>;
  for (const it of items) uit[it.soort] += it.aantal;
  return uit;
}
