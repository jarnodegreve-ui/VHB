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

/** Celkleur mét de uitzonderingen van Jarno: ziekte altijd rood (de code
 *  "ziek", ongeacht de categorie) en een geruilde of handmatig overgezette
 *  dienst geel (amber) — 08-09. Sinds 17-09 krijgt ook de tegenkant een
 *  kleur: wie zijn dienst wegruilde staat rood vrij, zodat een weggeruilde
 *  dag niet op een gewone vrije dag lijkt. Alles daarbuiten volgt de soort.
 *
 *  Rood dus tweemaal, met een ander woord in de cel ("ziek" tegenover
 *  "vrij") en een eigen tooltip; de stippellijn eronder verraadt dat het om
 *  een wissel gaat, net als bij de gele kant. */
type CelInfo = { kind: CellKind; code: string; swapId?: string | null; swapAway?: boolean | null };
export const isZiekCode = (code: string | undefined | null): boolean => String(code ?? '').trim().toLowerCase() === 'ziek';
/** Dienst weggeruild: deze chauffeur staat daardoor vrij. */
const isWeggeruild = (cel: CelInfo): boolean => Boolean(cel.swapId && cel.swapAway);
export const celChipClass = (cel: CelInfo): string =>
  isWeggeruild(cel) ? 'bg-red-50 text-red-700' : cel.swapId ? 'bg-amber-50 text-amber-800' : isZiekCode(cel.code) ? 'bg-red-50 text-red-700' : KIND_CLS[cel.kind];
export const celTextClass = (cel: CelInfo): string =>
  isWeggeruild(cel) ? 'font-semibold text-red-700 border-b border-dashed border-red-500/80' : cel.swapId ? 'font-semibold text-amber-700 border-b border-dashed border-amber-500/80' : isZiekCode(cel.code) ? 'text-red-700 font-semibold' : KIND_TEXT[cel.kind];
export const celBadgeTone = (cel: CelInfo): 'oker' | 'blue' | 'slate' | 'emerald' | 'red' | 'amber' =>
  isWeggeruild(cel) ? 'red' : cel.swapId ? 'amber' : isZiekCode(cel.code) ? 'red' : KIND_BADGE_TONE[cel.kind];
