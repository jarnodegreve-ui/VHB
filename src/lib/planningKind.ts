import type { CellKind } from './monthPlanning';

/**
 * Eén kleurentaal voor planningscel-soorten, gedeeld door Maandplanning
 * (CapacityView) en Planning-overzicht (PlanningMatrixView). Voorheen hadden
 * beide views een tegenstrijdige legende (dienst was daar oker vs. blauw,
 * opleiding blauw vs. groen…) — wie beide schermen gebruikt leerde twee talen.
 *
 * Semantiek: dienst = oker (merk-moment), verlof = blauw (neutraal-informatief,
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
  service: 'bg-oker-50 text-oker-700',
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
export const KIND_BADGE_TONE: Record<CellKind, 'oker' | 'blue' | 'slate' | 'emerald' | 'red'> = {
  service: 'oker',
  leave: 'blue',
  absence: 'slate',
  training: 'emerald',
  unknown: 'red',
};
