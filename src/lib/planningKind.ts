import type { CellKind } from './monthPlanning';

/**
 * Eén kleurentaal voor planningscel-soorten, gedeeld door Maandplanning
 * (CapacityView) en Planning-overzicht (PlanningMatrixView). Voorheen hadden
 * beide views een tegenstrijdige legende (dienst was daar oker vs. blauw,
 * opleiding blauw vs. groen…) — wie beide schermen gebruikt leerde twee talen.
 *
 * Semantiek: dienst = neutraal (A, 24-09: een gewone dienst is geen taak van
 * goud; goud blijft voor vandaag/"nu"), verlof = blauw (neutraal-informatief,
 * bewust GEEN amber — amber is de waarschuwingskleur), afwezig = slate,
 * opleiding = emerald, onbekend = red (moet opgelost worden).
 */
export const KIND_LABEL: Record<CellKind, string> = {
  service: 'Dienst',
  leave: 'Verlof',
  absence: 'Afwezig',
  training: 'Opleiding',
  unknown: 'Onbekende code',
};

/** Chip/pill-klassen (achtergrond + tekst) — dark-overrides zitten in index.css. */
export const KIND_CLS: Record<CellKind, string> = {
  service: 'bg-surface-muted text-slate-800',
  leave: 'bg-blue-50 text-blue-700',
  absence: 'bg-slate-100 text-slate-600',
  training: 'bg-emerald-50 text-emerald-700',
  unknown: 'bg-red-50 text-red-700',
};

/** Platte tekstkleur (Excel-look van het maandgrid). */
export const KIND_TEXT: Record<CellKind, string> = {
  service: 'text-slate-900 font-semibold',
  leave: 'text-blue-700 font-semibold',
  absence: 'text-slate-500',
  training: 'text-emerald-700 font-semibold',
  unknown: 'text-red-700 font-semibold',
};

/** Badge-tone (voor de Badge-primitive in het Planning-overzicht). */
export const KIND_BADGE_TONE: Record<CellKind, 'blue' | 'slate' | 'emerald' | 'red'> = {
  service: 'slate',
  leave: 'blue',
  absence: 'slate',
  training: 'emerald',
  unknown: 'red',
};

/** Celkleur mét de twee uitzonderingen van Jarno, omgewisseld op 17-09 zodat
 *  het maandbeeld dezelfde taal spreekt als zijn Excel: **rood = dienstruil**
 *  (beide kanten: de verhuisde dienst én het "vrij" dat de gever overhoudt)
 *  en **geel/oranje = ziekte** (de code "ziek", ongeacht de categorie). Stond
 *  eerder andersom (08-09: ziek rood, ruil amber), wat twee soorten wissels
 *  in twee kleuren liet vallen. Alles daarbuiten volgt de soort.
 *
 *  De stippellijn onder de cel blijft het teken "dit wijkt af van de
 *  geïmporteerde Excel"; de code in de cel ("ziek" tegenover een dienstnummer
 *  of "vrij") en de tooltip zeggen welk van de twee het is. */
type CelInfo = { kind: CellKind; code: string; swapId?: string | null };
export const isZiekCode = (code: string | undefined | null): boolean => String(code ?? '').trim().toLowerCase() === 'ziek';
export const celChipClass = (cel: CelInfo): string =>
  cel.swapId ? 'bg-red-50 text-red-700' : isZiekCode(cel.code) ? 'bg-amber-50 text-amber-800' : KIND_CLS[cel.kind];
export const celTextClass = (cel: CelInfo): string =>
  cel.swapId ? 'font-semibold text-red-700 border-b border-dashed border-red-500/80' : isZiekCode(cel.code) ? 'text-amber-700 font-semibold' : KIND_TEXT[cel.kind];
export const celBadgeTone = (cel: CelInfo): 'blue' | 'slate' | 'emerald' | 'red' | 'amber' =>
  cel.swapId ? 'red' : isZiekCode(cel.code) ? 'amber' : KIND_BADGE_TONE[cel.kind];
